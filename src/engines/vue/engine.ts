import * as fs from "node:fs";
import * as path from "node:path";
import type { Language } from "@volar/language-core";
import { isWithinWorkspace } from "../../workspace.js";
import { EngineError } from "../errors.js";
import { applyTextEdits, offsetToLineCol } from "../text-utils.js";
import { findTsConfigForFile } from "../ts/project.js";
import type {
  FindReferencesResult,
  GetDefinitionResult,
  MoveResult,
  MoveSymbolResult,
  RefactorEngine,
  RenameResult,
} from "../types.js";
import { SKIP_DIRS } from "../file-walk.js";
import { updateVueImportsAfterMove } from "./scan.js";

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
  ): readonly { fileName: string; textSpan: { start: number; length: number }; name: string }[] | undefined;
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

  /**
   * Translate a real `.vue` file path + offset to the virtual `.vue.ts` path + offset
   * that Volar's TypeScript program understands. Plain `.ts` paths pass through unchanged.
   * Used before operations where the Volar proxy does NOT perform this translation itself
   * (e.g. `getDefinitionAtPosition`).
   */
  private toVirtualLocation(
    realPath: string,
    pos: number,
    language: import("@volar/language-core").Language<string>,
    vueVirtualToReal: Map<string, string>,
  ): { fileName: string; pos: number } {
    if (!realPath.endsWith(".vue")) {
      return { fileName: realPath, pos };
    }

    const virtualPath = `${realPath}.ts`;
    if (!vueVirtualToReal.has(virtualPath)) {
      return { fileName: realPath, pos };
    }

    const sourceScript = language.scripts.get(realPath);
    if (!sourceScript?.generated) {
      return { fileName: virtualPath, pos };
    }

    const serviceScript = sourceScript.generated.languagePlugin.typescript?.getServiceScript(
      sourceScript.generated.root,
    );
    if (!serviceScript) {
      return { fileName: virtualPath, pos };
    }

    const mapper = language.maps.get(serviceScript.code, sourceScript);
    const iter = mapper.toGeneratedLocation(pos);
    const next = iter.next() as IteratorResult<readonly [number, unknown]>;
    if (!next.done) {
      return { fileName: virtualPath, pos: next.value[0] };
    }

    // Position not mappable — fall back to the virtual path with original offset.
    return { fileName: virtualPath, pos };
  }

  /**
   * Translate virtual `.vue.ts` locations back to real `.vue` source positions
   * using Volar's source maps. Plain `.ts` locations pass through unchanged.
   * Locations with no source mapping (Volar glue code) are dropped.
   */
  private translateLocations(
    rawLocations: readonly { fileName: string; textSpan: { start: number; length: number } }[],
    language: import("@volar/language-core").Language<string>,
    vueVirtualToReal: Map<string, string>,
  ): { fileName: string; textSpan: { start: number; length: number } }[] {
    const locations: { fileName: string; textSpan: { start: number; length: number } }[] = [];
    for (const loc of rawLocations) {
      const realVuePath = vueVirtualToReal.get(loc.fileName);
      if (realVuePath === undefined) {
        locations.push(loc);
        continue;
      }

      const sourceScript = language.scripts.get(realVuePath);
      if (!sourceScript?.generated) {
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
      // Locations with no source mapping are Volar glue code — skip them.
    }
    return locations;
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
      throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
    }

    const { languageService, fileContents, language, vueVirtualToReal } =
      await this.getService(absPath);

    const content = fs.readFileSync(absPath, "utf8");
    fileContents.set(absPath, content);

    // Convert 1-based line/col to 0-based offset
    const lines = content.split("\n");
    if (line - 1 >= lines.length) {
      throw new EngineError(`Line ${line} out of range in ${filePath}`, "SYMBOL_NOT_FOUND");
    }
    let pos = 0;
    for (let i = 0; i < line - 1; i++) {
      pos += lines[i].length + 1; // +1 for \n
    }
    pos += col - 1;

    const rawLocations = languageService.findRenameLocations(absPath, pos, false, false, {});
    if (!rawLocations || rawLocations.length === 0) {
      throw new EngineError(`No renameable symbol at line ${line}, col ${col} in ${filePath}`, "SYMBOL_NOT_FOUND");
    }

    const locations = this.translateLocations(rawLocations, language, vueVirtualToReal);

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

  async findReferences(
    filePath: string,
    line: number,
    col: number,
  ): Promise<FindReferencesResult> {
    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
      throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
    }

    const { languageService, fileContents, language, vueVirtualToReal } =
      await this.getService(absPath);

    const content = fs.readFileSync(absPath, "utf8");
    fileContents.set(absPath, content);

    const lines = content.split("\n");
    if (line - 1 >= lines.length) {
      throw new EngineError(`Line ${line} out of range in ${filePath}`, "SYMBOL_NOT_FOUND");
    }
    let pos = 0;
    for (let i = 0; i < line - 1; i++) {
      pos += lines[i].length + 1; // +1 for \n
    }
    pos += col - 1;

    const rawRefs = languageService.getReferencesAtPosition(absPath, pos);
    if (!rawRefs || rawRefs.length === 0) {
      throw new EngineError(`No symbol at line ${line}, col ${col} in ${filePath}`, "SYMBOL_NOT_FOUND");
    }

    const refs = this.translateLocations(rawRefs, language, vueVirtualToReal);

    // Extract symbol name from the first translated location.
    const firstRef = refs[0];
    const firstContent =
      fileContents.get(firstRef.fileName) ?? fs.readFileSync(firstRef.fileName, "utf8");
    const symbolName = firstContent.slice(
      firstRef.textSpan.start,
      firstRef.textSpan.start + firstRef.textSpan.length,
    );

    const references = refs.map((ref) => {
      const refContent =
        fileContents.get(ref.fileName) ?? fs.readFileSync(ref.fileName, "utf8");
      const lc = offsetToLineCol(refContent, ref.textSpan.start);
      return { file: ref.fileName, line: lc.line, col: lc.col, length: ref.textSpan.length };
    });

    return { symbolName, references };
  }

  async getDefinition(
    filePath: string,
    line: number,
    col: number,
  ): Promise<GetDefinitionResult> {
    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
      throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
    }

    const { languageService, fileContents, language, vueVirtualToReal } =
      await this.getService(absPath);

    const content = fs.readFileSync(absPath, "utf8");
    fileContents.set(absPath, content);

    const lines = content.split("\n");
    if (line - 1 >= lines.length) {
      throw new EngineError(`Line ${line} out of range in ${filePath}`, "SYMBOL_NOT_FOUND");
    }
    let pos = 0;
    for (let i = 0; i < line - 1; i++) {
      pos += lines[i].length + 1; // +1 for \n
    }
    pos += col - 1;

    // getDefinitionAtPosition does not auto-translate .vue → .vue.ts the way
    // findRenameLocations / getReferencesAtPosition do, so we translate first.
    const { fileName: queryFile, pos: queryPos } = this.toVirtualLocation(
      absPath,
      pos,
      language,
      vueVirtualToReal,
    );

    const rawDefs = languageService.getDefinitionAtPosition(queryFile, queryPos);
    if (!rawDefs || rawDefs.length === 0) {
      throw new EngineError(`No symbol at line ${line}, col ${col} in ${filePath}`, "SYMBOL_NOT_FOUND");
    }

    const symbolName = rawDefs[0].name;
    const defs = this.translateLocations(rawDefs, language, vueVirtualToReal);

    const definitions = defs.map((def) => {
      const defContent = fileContents.get(def.fileName) ?? fs.readFileSync(def.fileName, "utf8");
      const lc = offsetToLineCol(defContent, def.textSpan.start);
      return { file: def.fileName, line: lc.line, col: lc.col, length: def.textSpan.length };
    });

    return { symbolName, definitions };
  }

  async moveSymbol(
    _sourceFile: string,
    symbolName: string,
    _destFile: string,
    _workspace: string,
  ): Promise<MoveSymbolResult> {
    throw new EngineError(`moveSymbol is not supported for Vue projects (symbol: '${symbolName}')`, "NOT_SUPPORTED");
  }

  async moveFile(oldPath: string, newPath: string, workspace: string): Promise<MoveResult> {
    const absOld = path.resolve(oldPath);
    const absNew = path.resolve(newPath);

    if (!fs.existsSync(absOld)) {
      throw new EngineError(`File not found: ${oldPath}`, "FILE_NOT_FOUND");
    }

    const { languageService, fileContents, vueVirtualToReal } = await this.getService(absOld);

    const edits = languageService.getEditsForFileRename(absOld, absNew, {}, {});

    // Apply import edits first, skipping files outside the workspace.
    const filesModified: string[] = [];
    const filesSkipped: string[] = [];
    for (const edit of edits) {
      if (edit.textChanges.length === 0) continue;
      // Virtual .vue.ts filenames have no disk representation. The regex scan
      // further below handles .vue SFC import rewrites directly.
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

    // Scan .vue SFCs for import rewrites the language service missed.
    // getEditsForFileRename skips virtual .vue.ts → real .vue translation for
    // move operations, so we handle those imports via a regex scan.
    const tsConfig = findTsConfigForFile(absOld);
    const searchRoot = tsConfig ? path.dirname(tsConfig) : path.dirname(absOld);
    const vueModified = updateVueImportsAfterMove(absOld, absNew, searchRoot);
    for (const f of vueModified) {
      if (!filesModified.includes(f)) filesModified.push(f);
    }

    if (!filesModified.includes(absNew)) {
      filesModified.push(absNew);
    }

    return { filesModified, filesSkipped, oldPath: absOld, newPath: absNew };
  }
}
