import * as fs from "node:fs";
import * as path from "node:path";
import type { Language } from "@volar/language-core";
import { SKIP_DIRS } from "../file-walk.js";

interface VolarLanguageService {
  findRenameLocations(
    fileName: string,
    position: number,
    findInStrings: boolean,
    findInComments: boolean,
    preferences?: object,
  ): readonly { fileName: string; textSpan: { start: number; length: number } }[] | undefined;
  getReferencesAtPosition(
    fileName: string,
    position: number,
  ): readonly { fileName: string; textSpan: { start: number; length: number } }[] | undefined;
  getDefinitionAtPosition(
    fileName: string,
    position: number,
  ):
    | readonly { fileName: string; textSpan: { start: number; length: number }; name: string }[]
    | undefined;
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

export interface CachedService {
  languageService: VolarLanguageService;
  fileContents: Map<string, string>;
  language: Language<string>;
  /** Maps virtual App.vue.ts filenames → real App.vue filenames */
  vueVirtualToReal: Map<string, string>;
}

export async function buildVolarService(
  tsConfigPath: string | null,
  rootFilePath: string,
): Promise<CachedService> {
  const ts = await import("typescript");
  const { createVueLanguagePlugin, getDefaultCompilerOptions } = await import("@vue/language-core");
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
          languageRef.scripts.set(id, snapshot, id.endsWith(".vue") ? "vue" : "typescript");
        }
      }
    },
  );
  languageRef = language;

  // Pre-load all project files so Volar generates their virtual TypeScript
  // before any language service operation runs.
  for (const fileId of projectFiles) {
    const content = readFile(fileId);
    if (content !== undefined) {
      const snapshot = ts.ScriptSnapshot.fromString(content);
      language.scripts.set(fileId, snapshot, fileId.endsWith(".vue") ? "vue" : "typescript");
    }
  }

  // Build virtual filename mapping.
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
      const realVuePath = vueVirtualToReal.get(filePath);
      if (realVuePath !== undefined) {
        const sourceScript = languageRef?.scripts.get(realVuePath);
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
    fileExists: (filePath) => {
      if (vueVirtualToReal.has(filePath)) return true;
      return ts.sys.fileExists(filePath);
    },
    readFile: (filePath) => {
      const realVuePath = vueVirtualToReal.get(filePath);
      if (realVuePath !== undefined) {
        const sourceScript = languageRef?.scripts.get(realVuePath);
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
