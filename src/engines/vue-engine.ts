import * as fs from "node:fs";
import * as path from "node:path";
import type { Language } from "@volar/language-core";
import { isWithinWorkspace } from "../daemon/workspace.js";
import { findTsConfigForFile } from "./project.js";
import { applyTextEdits } from "./text-utils.js";
import type { MoveResult, MoveSymbolResult, RefactorEngine, RenameResult } from "./types.js";
import { SKIP_DIRS, updateVueImportsAfterMove } from "./vue-scan.js";

interface VolarLanguageService {
  findRenameLocations(
    fileName: string,
    position: number,
    findInStrings: boolean,
    findInComments: boolean,
    preferences?: object,
  ): readonly { fileName: string; textSpan: { start: number; length: number } }[] | undefined;
  getEditsForFileRename(
    oldFilePath: string,
    newFilePath: string,
    formatOptions: object,
    preferences: object,
  ): readonly {
    fileName: string;
    textChanges: { span: { start: number; length: number }; newText: string }[];
  }[];
}

interface CachedService {
  languageService: VolarLanguageService;
  fileContents: Map<string, string>;
  language: Language<string>;
  /** Maps virtual App.vue.ts filenames → real App.vue filenames */
  vueVirtualToReal: Map<string, string>;
}

export class VueEngine implements RefactorEngine {
  private services = new Map<string, CachedService>();

  private async buildService(
    tsConfigPath: string | null,
    rootFilePath: string,
  ): Promise<CachedService> {
    const ts = await import("typescript");
    const { createVueLanguagePlugin, getDefaultCompilerOptions } = await import(
      "@vue/language-core"
    );
    const { decorateLanguageServiceHost, createProxyLanguageService } = await import(
      "@volar/typescript"
    );
    const { createLanguage } = await import("@vue/language-core");

    const fileContents = new Map<string, string>();

    const readFile = (filePath: string): string | undefined => {
      if (fileContents.has(filePath)) return fileContents.get(filePath);
      try {
        const content = fs.readFileSync(filePath, "utf8");
        fileContents.set(filePath, content);
        return content;
      } catch {
        return undefined;
      }
    };

    let compilerOptions: import("typescript").CompilerOptions = {};

    if (tsConfigPath) {
      const parsed = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
      if (!parsed.error) {
        const result = ts.parseJsonConfigFileContent(
          parsed.config,
          ts.sys,
          path.dirname(tsConfigPath),
        );
        compilerOptions = result.options;
      }
    }

    const vueCompilerOptions = getDefaultCompilerOptions();

    const vuePlugin = createVueLanguagePlugin<string>(
      ts,
      compilerOptions,
      vueCompilerOptions,
      (id) => id,
    );

    // Collect project files from tsconfig (or fall back to the root file alone).
    const projectFiles: string[] = [];
    const projectRoot = tsConfigPath ? path.dirname(tsConfigPath) : path.dirname(rootFilePath);
    if (tsConfigPath) {
      const parsed = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
      if (!parsed.error) {
        const result = ts.parseJsonConfigFileContent(parsed.config, ts.sys, projectRoot);
        projectFiles.push(...result.fileNames);
      }
    } else {
      projectFiles.push(rootFilePath);
    }

    // Always include .vue files from the project directory, even when the
    // tsconfig does not list them (e.g. bundler-only Vue setups).
    // Filter out build/tool directories (same skip list as vue-scan.ts).
    const vueFilesOnDisk = ts.sys
      .readDirectory(projectRoot, [".vue"], [], [], 1000)
      .filter((f) => !f.split("/").some((seg) => SKIP_DIRS.has(seg)));
    for (const f of vueFilesOnDisk) {
      if (!projectFiles.includes(f)) projectFiles.push(f);
    }

    const scriptRegistry = new Map();

    // languageRef is assigned synchronously after createLanguage returns.
    // The sync callback is only invoked lazily — never during construction.
    let languageRef: Language<string>;

    const language = createLanguage<string>(
      [vuePlugin],
      scriptRegistry,
      (id, _includeFsFiles, shouldRegister) => {
        if (shouldRegister) {
          const content = readFile(id);
          if (content !== undefined) {
            const snapshot = ts.ScriptSnapshot.fromString(content);
            // Use the managed scripts.set() so SourceScript entries are fully
            // initialised (targetIds, associatedIds, virtual code, etc.).
            languageRef.scripts.set(id, snapshot, id.endsWith(".vue") ? "vue" : "typescript");
          }
        }
      },
    );
    languageRef = language;

    // Pre-load all project files so Volar generates their virtual TypeScript
    // before any language service operation runs. Without this, .vue files
    // discovered via the directory scan are not in the registry when
    // findRenameLocations traverses the project, and cross-file references
    // inside Vue SFCs are silently missed.
    for (const fileId of projectFiles) {
      const content = readFile(fileId);
      if (content !== undefined) {
        const snapshot = ts.ScriptSnapshot.fromString(content);
        language.scripts.set(fileId, snapshot, fileId.endsWith(".vue") ? "vue" : "typescript");
      }
    }

    // Build virtual filename mapping.
    //
    // TypeScript's program builder silently ignores non-.ts/.tsx filenames in
    // getScriptFileNames. We expose each .vue file as a virtual "<file>.vue.ts"
    // alias so TypeScript's program analyzes it. When TypeScript reads the
    // snapshot for App.vue.ts we serve the Volar-generated TypeScript content
    // for App.vue. After findRenameLocations returns positions in App.vue.ts we
    // translate them back to App.vue positions via Volar's source maps.
    const vueVirtualToReal = new Map<string, string>(); // App.vue.ts → App.vue
    for (const fileId of projectFiles) {
      if (fileId.endsWith(".vue")) {
        vueVirtualToReal.set(`${fileId}.ts`, fileId);
      }
    }

    // Replace .vue entries with their virtual .vue.ts equivalents.
    const scriptFileNames = projectFiles.map((f) => (f.endsWith(".vue") ? `${f}.ts` : f));

    const versions = new Map<string, number>();
    const getVersion = (filePath: string) => String(versions.get(filePath) ?? 0);

    const host: import("typescript").LanguageServiceHost = {
      getCompilationSettings: () => compilerOptions,
      getScriptFileNames: () => scriptFileNames,
      getScriptVersion: (filePath) => {
        const realPath = vueVirtualToReal.get(filePath) ?? filePath;
        return getVersion(realPath);
      },
      getScriptSnapshot: (filePath) => {
        // For virtual .vue.ts files, serve the Volar-generated TypeScript snapshot.
        const realVuePath = vueVirtualToReal.get(filePath);
        if (realVuePath !== undefined) {
          const sourceScript = languageRef?.scripts.get(realVuePath);
          if (sourceScript?.generated) {
            const serviceScript =
              sourceScript.generated.languagePlugin.typescript?.getServiceScript(
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
      fileExists: (filePath) => {
        if (vueVirtualToReal.has(filePath)) return true;
        return ts.sys.fileExists(filePath);
      },
      readFile: (filePath) => {
        // For virtual .vue.ts files, serve the generated TypeScript text.
        const realVuePath = vueVirtualToReal.get(filePath);
        if (realVuePath !== undefined) {
          const sourceScript = languageRef?.scripts.get(realVuePath);
          if (sourceScript?.generated) {
            const serviceScript =
              sourceScript.generated.languagePlugin.typescript?.getServiceScript(
                sourceScript.generated.root,
              );
            if (serviceScript) {
              return serviceScript.code.snapshot.getText(
                0,
                serviceScript.code.snapshot.getLength(),
              );
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

    decorateLanguageServiceHost(ts, language, host);

    const baseService = ts.createLanguageService(host);
    const { proxy, initialize } = createProxyLanguageService(baseService);
    initialize(language);

    return {
      languageService: proxy as unknown as VolarLanguageService,
      fileContents,
      language,
      vueVirtualToReal,
    };
  }

  private async getService(filePath: string): Promise<CachedService> {
    const tsConfigPath = findTsConfigForFile(filePath);
    const cacheKey = tsConfigPath ?? `__no_tsconfig__:${path.dirname(filePath)}`;

    let cached = this.services.get(cacheKey);
    if (!cached) {
      cached = await this.buildService(tsConfigPath, filePath);
      this.services.set(cacheKey, cached);
    }
    return cached;
  }

  private invalidateService(filePath: string): void {
    const tsConfigPath = findTsConfigForFile(filePath);
    this.services.delete(tsConfigPath ?? `__no_tsconfig__:${path.dirname(filePath)}`);
  }

  async rename(
    filePath: string,
    line: number,
    col: number,
    newName: string,
    workspace: string,
  ): Promise<RenameResult> {
    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
      throw Object.assign(new Error(`File not found: ${filePath}`), {
        code: "FILE_NOT_FOUND" as const,
      });
    }

    const { languageService, fileContents, language, vueVirtualToReal } =
      await this.getService(absPath);

    const content = fs.readFileSync(absPath, "utf8");
    fileContents.set(absPath, content);

    // Convert 1-based line/col to 0-based offset
    const lines = content.split("\n");
    if (line - 1 >= lines.length) {
      throw Object.assign(new Error(`Line ${line} out of range in ${filePath}`), {
        code: "SYMBOL_NOT_FOUND" as const,
      });
    }
    let pos = 0;
    for (let i = 0; i < line - 1; i++) {
      pos += lines[i].length + 1; // +1 for \n
    }
    pos += col - 1;

    const rawLocations = languageService.findRenameLocations(absPath, pos, false, false, {});
    if (!rawLocations || rawLocations.length === 0) {
      throw Object.assign(
        new Error(`No renameable symbol at line ${line}, col ${col} in ${filePath}`),
        { code: "SYMBOL_NOT_FOUND" as const },
      );
    }

    // Translate virtual .vue.ts locations back to real .vue file positions.
    //
    // TypeScript analyses App.vue.ts (the virtual alias) and returns offsets
    // inside the Volar-generated TypeScript for that file. We use Volar's
    // source maps (language.maps) to map each generated offset back to its
    // original position in the .vue source file.
    const locations: { fileName: string; textSpan: { start: number; length: number } }[] = [];
    for (const loc of rawLocations) {
      const realVuePath = vueVirtualToReal.get(loc.fileName);
      if (realVuePath === undefined) {
        // Regular .ts/.tsx file — no translation needed.
        locations.push(loc);
        continue;
      }

      const sourceScript = language.scripts.get(realVuePath);
      if (!sourceScript?.generated) {
        // No generated code; fall back to the real path with the original offset.
        locations.push({ fileName: realVuePath, textSpan: loc.textSpan });
        continue;
      }

      const serviceScript = sourceScript.generated.languagePlugin.typescript?.getServiceScript(
        sourceScript.generated.root,
      );
      if (!serviceScript) {
        locations.push({ fileName: realVuePath, textSpan: loc.textSpan });
        continue;
      }

      // Map the generated-code offset to the original .vue source offset.
      const mapper = language.maps.get(serviceScript.code, sourceScript);
      const iter = mapper.toSourceLocation(loc.textSpan.start);
      const next = iter.next() as IteratorResult<readonly [number, unknown]>;
      if (!next.done) {
        const [sourceOffset] = next.value;
        locations.push({
          fileName: realVuePath,
          textSpan: { start: sourceOffset, length: loc.textSpan.length },
        });
      }
      // If the offset has no source mapping it is in Volar glue code — skip it.
    }

    // Determine the original symbol name from the first translated location.
    const firstLoc = locations[0];
    const firstContent =
      fileContents.get(firstLoc.fileName) ?? fs.readFileSync(firstLoc.fileName, "utf8");
    const oldName = firstContent.slice(
      firstLoc.textSpan.start,
      firstLoc.textSpan.start + firstLoc.textSpan.length,
    );

    // Group edits by file and apply
    const fileEdits = new Map<
      string,
      { span: { start: number; length: number }; newText: string }[]
    >();
    for (const loc of locations) {
      if (!fileEdits.has(loc.fileName)) fileEdits.set(loc.fileName, []);
      fileEdits.get(loc.fileName)?.push({
        span: loc.textSpan,
        newText: newName,
      });
    }

    const filesModified: string[] = [];
    const filesSkipped: string[] = [];
    for (const [fileName, edits] of fileEdits) {
      if (!isWithinWorkspace(fileName, workspace)) {
        filesSkipped.push(fileName);
        continue;
      }
      const original = fileContents.get(fileName) ?? fs.readFileSync(fileName, "utf8");
      const updated = applyTextEdits(original, edits);
      fs.writeFileSync(fileName, updated, "utf8");
      fileContents.set(fileName, updated);
      filesModified.push(fileName);
    }

    return {
      filesModified,
      filesSkipped,
      symbolName: oldName,
      newName,
      locationCount: locations.length,
    };
  }

  async moveSymbol(
    _sourceFile: string,
    symbolName: string,
    _destFile: string,
    _workspace: string,
  ): Promise<MoveSymbolResult> {
    throw Object.assign(
      new Error(`moveSymbol is not supported for Vue projects (symbol: '${symbolName}')`),
      { code: "NOT_SUPPORTED" as const },
    );
  }

  async moveFile(oldPath: string, newPath: string, workspace: string): Promise<MoveResult> {
    const absOld = path.resolve(oldPath);
    const absNew = path.resolve(newPath);

    if (!fs.existsSync(absOld)) {
      throw Object.assign(new Error(`File not found: ${oldPath}`), {
        code: "FILE_NOT_FOUND" as const,
      });
    }

    const { languageService, fileContents, vueVirtualToReal } = await this.getService(absOld);

    const edits = languageService.getEditsForFileRename(absOld, absNew, {}, {});

    // Apply import edits first, skipping files outside the workspace.
    const filesModified: string[] = [];
    const filesSkipped: string[] = [];
    for (const edit of edits) {
      if (edit.textChanges.length === 0) continue;
      // Virtual .vue.ts filenames have no disk representation. The
      // updateVueImportsAfterMove scan below handles .vue file rewrites.
      if (vueVirtualToReal.has(edit.fileName)) continue;
      if (!isWithinWorkspace(edit.fileName, workspace)) {
        if (!filesSkipped.includes(edit.fileName)) filesSkipped.push(edit.fileName);
        continue;
      }
      const original = fileContents.get(edit.fileName) ?? fs.readFileSync(edit.fileName, "utf8");
      const updated = applyTextEdits(original, edit.textChanges);
      fs.writeFileSync(edit.fileName, updated, "utf8");
      fileContents.set(edit.fileName, updated);
      if (!filesModified.includes(edit.fileName)) {
        filesModified.push(edit.fileName);
      }
    }

    // Ensure destination directory exists, then move the file
    const destDir = path.dirname(absNew);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.renameSync(absOld, absNew);

    // Invalidate the cached service: scriptFileNames was built from the pre-move
    // filesystem state. The next call rebuilds from current disk state.
    this.invalidateService(absOld);

    if (!filesModified.includes(absNew)) {
      filesModified.push(absNew);
    }

    // Volar's getEditsForFileRename doesn't rewrite imports inside .vue SFCs;
    // do a targeted regex scan to cover what the language service misses.
    const tsConfigPath = findTsConfigForFile(absOld);
    const searchRoot = tsConfigPath ? path.dirname(tsConfigPath) : path.dirname(absOld);
    const vueModified = updateVueImportsAfterMove(absOld, absNew, searchRoot);
    for (const f of vueModified) {
      if (!filesModified.includes(f)) filesModified.push(f);
    }

    return { filesModified, filesSkipped, oldPath: absOld, newPath: absNew };
  }
}
