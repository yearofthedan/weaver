import * as fs from "node:fs";
import * as path from "node:path";
import type { Language } from "@volar/language-core";
import type ts from "typescript";
import { TS_EXTENSIONS } from "../../utils/extensions.js";
import { SKIP_DIRS, walkFiles } from "../../utils/file-walk.js";

type VolarLanguageService = Pick<
  ts.LanguageService,
  | "findRenameLocations"
  | "getReferencesAtPosition"
  | "getDefinitionAtPosition"
  | "getEditsForFileRename"
>;

/** A `.vue` file's virtual name in the language service — every other path is unchanged. */
export function toVirtualVuePath(filePath: string): string {
  return filePath.endsWith(".vue") ? `${filePath}.ts` : filePath;
}

export interface CachedService {
  languageService: VolarLanguageService;
  /** The raw TypeScript language service (pre-Volar proxy). Use for APIs not exposed by the proxy (e.g. getFileReferences). */
  baseService: ts.LanguageService;
  fileContents: Map<string, string>;
  language: Language<string>;
  /** Maps virtual App.vue.ts filenames → real App.vue filenames */
  vueVirtualToReal: Map<string, string>;
  /**
   * Every file the language service serves, with `.vue` entries replaced by their
   * virtual `.vue.ts` name. Matches the set `TsMorphEngine` builds for the same
   * workspace, so project-wide diagnostics report the same files whichever engine
   * answers.
   */
  scriptFileNames: string[];
  /**
   * The tsconfig's own files plus the on-disk `.vue` files `buildVolarService`
   * adds even when the tsconfig doesn't list them (e.g. bundler-only Vue
   * setups) — `scriptFileNames` before the workspace walk further widens it
   * for cross-file operations like rename. `null` when there's no tsconfig.
   * See `typeCheckedFiles` for the seed's general contract.
   */
  seedFileNames: string[] | null;
  /**
   * `scriptFileNames` as the service was built with it. `addScriptFile` widens the live
   * list for the query that asked for it; the project-wide check reads this snapshot for
   * the files it walks and asks about, so `checked` and `unchecked` describe the file set
   * the service was built with. The compiled program is shared with the add, so an
   * in-program file's import of an added SFC resolves once a query has added it.
   */
  builtFileNames: ReadonlySet<string>;
  /**
   * Re-read `filePath` from disk into the retained language service, so a later
   * query is answered from the text on disk rather than the snapshot taken when
   * the service was built. The service itself stays cached.
   *
   * All three steps are needed: the new text replaces what the host serves, the
   * version makes the TypeScript language service take a fresh snapshot, and the
   * `scripts` registration is what makes Volar regenerate a `.vue` file's virtual
   * TypeScript. A path that can no longer be read loses its cached text and its script
   * registration and still bumps its version, so the service stops serving the text
   * that was there and a deleted SFC stops resolving for its importers.
   */
  rereadFile(filePath: string): void;
  /**
   * Adds `filePath` to the language service's file set so a later query answers
   * for it, for a path the tsconfig's own file set and the workspace walk both
   * missed. A `.vue` path joins under its virtual `.vue.ts` name with its script
   * registered, so Volar generates that virtual TypeScript; any other path joins
   * as itself. Content and version follow the same read path as `rereadFile`. A
   * path already in the set, or one that cannot be read, is left alone.
   */
  addScriptFile(filePath: string): void;
}

function parseTsConfig(
  tsConfigPath: string | null,
  ts: typeof import("typescript"),
): { compilerOptions: import("typescript").CompilerOptions; fileNames: string[] } {
  if (!tsConfigPath) {
    return { compilerOptions: {}, fileNames: [] };
  }
  const parsed = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
  if (parsed.error) {
    return { compilerOptions: {}, fileNames: [] };
  }
  const result = ts.parseJsonConfigFileContent(parsed.config, ts.sys, path.dirname(tsConfigPath));
  return { compilerOptions: result.options, fileNames: result.fileNames };
}

function buildLanguageServiceHost(params: {
  compilerOptions: import("typescript").CompilerOptions;
  scriptFileNames: string[];
  vueVirtualToReal: Map<string, string>;
  languageRef: { current: Language<string> | undefined };
  tsConfigPath: string | null;
  readFile: (filePath: string) => string | undefined;
  versions: Map<string, number>;
  registerResolvedSfc: (virtualPath: string) => string | undefined;
  ts: typeof import("typescript");
}): import("typescript").LanguageServiceHost {
  const {
    compilerOptions,
    scriptFileNames,
    vueVirtualToReal,
    languageRef,
    tsConfigPath,
    readFile,
    versions,
    registerResolvedSfc,
    ts,
  } = params;
  const getVersion = (filePath: string) => String(versions.get(filePath) ?? 0);

  return {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => scriptFileNames,
    getScriptVersion: (filePath) => {
      const realPath = vueVirtualToReal.get(filePath) ?? filePath;
      return getVersion(realPath);
    },
    getScriptSnapshot: (filePath) => {
      const realVuePath = registerResolvedSfc(filePath);
      if (realVuePath !== undefined) {
        const sourceScript = languageRef.current?.scripts.get(realVuePath);
        if (sourceScript?.generated) {
          const serviceScript = sourceScript.generated.languagePlugin.typescript?.getServiceScript(
            sourceScript.generated.root,
          );
          if (serviceScript) return serviceScript.code.snapshot;
        }
        return undefined;
      }
      const content = readFile(filePath);
      return content !== undefined ? ts.ScriptSnapshot.fromString(content) : undefined;
    },
    getCurrentDirectory: () => (tsConfigPath ? path.dirname(tsConfigPath) : process.cwd()),
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    // Why identity canonicalisation: docs/tech/volar-v3.md.
    useCaseSensitiveFileNames: () => true,
    fileExists: (filePath) => {
      if (registerResolvedSfc(filePath) !== undefined) return true;
      return ts.sys.fileExists(filePath);
    },
    readFile: (filePath) => {
      const realVuePath = registerResolvedSfc(filePath);
      if (realVuePath !== undefined) {
        const sourceScript = languageRef.current?.scripts.get(realVuePath);
        if (sourceScript?.generated) {
          const serviceScript = sourceScript.generated.languagePlugin.typescript?.getServiceScript(
            sourceScript.generated.root,
          );
          if (serviceScript) {
            return serviceScript.code.snapshot.getText(0, serviceScript.code.snapshot.getLength());
          }
        }
        return undefined;
      }
      return ts.sys.readFile(filePath);
    },
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
}

export async function buildVolarService(
  tsConfigPath: string | null,
  rootFilePath: string | undefined,
  workspaceRoot?: string,
): Promise<CachedService> {
  const ts = await import("typescript");
  const { createVueLanguagePlugin, getDefaultCompilerOptions } = await import("@vue/language-core");
  const { decorateLanguageServiceHost, createProxyLanguageService } = await import(
    "@volar/typescript"
  );
  const { createLanguage } = await import("@vue/language-core");

  const fileContents = new Map<string, string>();
  // Versioned per file so `rereadFile` can make the language service take a
  // fresh snapshot of a file whose text changed on disk. The language service
  // compares versions for change, so each refresh moves the value to a new one.
  const versions = new Map<string, number>();

  const readFileFromDisk = (filePath: string): string | undefined => {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return undefined;
    }
  };

  const readFile = (filePath: string): string | undefined => {
    const cached = fileContents.get(filePath);
    if (cached !== undefined) return cached;
    const content = readFileFromDisk(filePath);
    if (content !== undefined) fileContents.set(filePath, content);
    return content;
  };

  const { compilerOptions, fileNames: tsConfigFileNames } = parseTsConfig(tsConfigPath, ts);

  const vueCompilerOptions = getDefaultCompilerOptions();

  const vuePlugin = createVueLanguagePlugin<string>(
    ts,
    compilerOptions,
    vueCompilerOptions,
    (id) => id,
  );

  // Collect project files from tsconfig (or fall back to the root file alone, if given).
  const projectFiles: string[] = tsConfigPath
    ? [...tsConfigFileNames]
    : rootFilePath
      ? [rootFilePath]
      : [];
  const projectRoot = tsConfigPath
    ? path.dirname(tsConfigPath)
    : rootFilePath
      ? path.dirname(rootFilePath)
      : (workspaceRoot ?? process.cwd());

  // Always include .vue files from the project directory, even when the
  // tsconfig does not list them (e.g. bundler-only Vue setups).
  const vueFilesOnDisk = ts.sys
    .readDirectory(projectRoot, [".vue"], [], [], 1000)
    .filter((f) => !f.split("/").some((seg) => SKIP_DIRS.has(seg)));
  for (const f of vueFilesOnDisk) {
    if (!projectFiles.includes(f)) projectFiles.push(f);
  }

  // Snapshot before the workspace walk below widens `projectFiles` further —
  // see `CachedService.seedFileNames` for what this snapshot holds.
  const seedFiles = [...projectFiles];

  // Include all workspace TS/JS files so test files and scripts outside
  // tsconfig.include are visible to the Volar language service.
  if (workspaceRoot) {
    const existingSet = new Set(projectFiles);
    for (const f of walkFiles(workspaceRoot, [...TS_EXTENSIONS])) {
      if (!existingSet.has(f)) projectFiles.push(f);
    }
  }

  const scriptRegistry = new Map();

  // languageRef is assigned synchronously after createLanguage returns.
  // The sync callback is only invoked lazily — never during construction.
  const languageRef: { current: Language<string> | undefined } = { current: undefined };

  const registerScript = (
    scripts: Language<string>["scripts"],
    fileId: string,
    content: string,
  ) => {
    scripts.set(
      fileId,
      ts.ScriptSnapshot.fromString(content),
      fileId.endsWith(".vue") ? "vue" : "typescript",
    );
  };

  const language = createLanguage<string>(
    [vuePlugin],
    scriptRegistry,
    (id, _includeFsFiles, shouldRegister) => {
      if (shouldRegister) {
        const content = readFile(id);
        const current = languageRef.current;
        if (content !== undefined && current !== undefined) {
          registerScript(current.scripts, id, content);
        }
      }
    },
  );
  languageRef.current = language;

  // Pre-load all project files so Volar generates their virtual TypeScript
  // before any language service operation runs.
  for (const fileId of projectFiles) {
    const content = readFile(fileId);
    if (content !== undefined) registerScript(language.scripts, fileId, content);
  }

  // Build virtual filename mapping.
  const vueVirtualToReal = new Map<string, string>(); // App.vue.ts → App.vue
  for (const fileId of projectFiles) {
    if (fileId.endsWith(".vue")) {
      vueVirtualToReal.set(`${fileId}.ts`, fileId);
    }
  }

  // Replace .vue entries with their virtual .vue.ts equivalents.
  const scriptFileNames = projectFiles.map(toVirtualVuePath);
  const builtFileNames: ReadonlySet<string> = new Set(scriptFileNames);
  const seedFileNames = tsConfigPath === null ? null : seedFiles.map(toVirtualVuePath);

  const bumpVersion = (filePath: string) => {
    // The language service compares a file's version for change, so the value's
    // direction and size never reach an answer.
    versions.set(filePath, (versions.get(filePath) ?? 0) + 1);
  };

  /**
   * The three steps a path needs before the service answers from `content`: the host's
   * cached text, Volar's script registration (which is what makes it regenerate a
   * `.vue` file's virtual TypeScript), and a new version so the TypeScript language
   * service discards the source files it parsed from the previous text.
   */
  const storeContent = (filePath: string, content: string) => {
    fileContents.set(filePath, content);
    registerScript(language.scripts, filePath, content);
    bumpVersion(filePath);
  };

  /**
   * Registers an SFC's virtual path on demand, at the moment the compiler resolves to it:
   * reads the real `.vue` from disk, stores the content, registers its script and maps the
   * virtual path, so the host answers for that path from here on. The host callbacks call it
   * while the compiler is resolving, which is when an import first asks about an SFC's
   * virtual name. Returns the real `.vue` path the service now holds, or undefined when the
   * path is not an SFC's virtual name, a real file answers for that name, or the SFC cannot
   * be read.
   */
  const registerResolvedSfc = (virtualPath: string): string | undefined => {
    if (!virtualPath.endsWith(".vue.ts")) return undefined;
    const held = vueVirtualToReal.get(virtualPath);
    if (held !== undefined) return held;
    // A real file at this name is what the compiler asked about, so the map leaves that name
    // to disk.
    if (ts.sys.fileExists(virtualPath)) return undefined;
    const realPath = virtualPath.slice(0, -".ts".length);
    const content = readFileFromDisk(realPath);
    if (content === undefined) return undefined;
    storeContent(realPath, content);
    vueVirtualToReal.set(virtualPath, realPath);
    return realPath;
  };

  const host = buildLanguageServiceHost({
    compilerOptions,
    scriptFileNames,
    vueVirtualToReal,
    languageRef,
    tsConfigPath,
    readFile,
    versions,
    registerResolvedSfc,
    ts,
  });

  decorateLanguageServiceHost(ts, language, host);

  const baseService = ts.createLanguageService(host);
  const { proxy, initialize } = createProxyLanguageService(baseService);
  initialize(language);

  return {
    languageService: proxy as unknown as VolarLanguageService,
    baseService,
    fileContents,
    language,
    vueVirtualToReal,
    scriptFileNames,
    builtFileNames,
    seedFileNames,
    rereadFile: (filePath) => {
      const content = readFileFromDisk(filePath);
      if (content === undefined) {
        fileContents.delete(filePath);
        // A `.vue` file's virtual TypeScript comes from the registered script, which the
        // host serves in preference to disk, so a deleted SFC keeps resolving for its
        // importers until the registration goes.
        language.scripts.delete(filePath);
        bumpVersion(filePath);
        return;
      }
      if (fileContents.get(filePath) === content) return;
      storeContent(filePath, content);
    },
    addScriptFile: (filePath) => {
      const virtualPath = toVirtualVuePath(filePath);
      if (scriptFileNames.includes(virtualPath)) return;
      // A `.vue` path registers through the same helper the host resolves with, so an SFC an
      // add brings in and one an import brings in are held identically; every other path is
      // content the service serves as-is.
      if (registerResolvedSfc(virtualPath) === undefined) {
        const content = readFileFromDisk(filePath);
        if (content === undefined) return;
        storeContent(filePath, content);
      }
      scriptFileNames.push(virtualPath);
    },
  };
}
