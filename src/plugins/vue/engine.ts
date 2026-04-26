import * as fs from "node:fs";
import * as path from "node:path";
import { EngineError } from "../../domain/errors.js";
import type { WorkspaceScope } from "../../domain/workspace-scope.js";
import type { GetTypeErrorsResult, RenameResult } from "../../operations/types.js";
import { applyRenameEdits, mergeFileEdits } from "../../ts-engine/apply-rename-edits.js";
import type { TsMorphEngine } from "../../ts-engine/engine.js";
import { tsMoveFile } from "../../ts-engine/move-file.js";
import type {
  DefinitionLocation,
  DeleteFileActionResult,
  Engine,
  ExtractFunctionResult,
  FileTextEdit,
  MoveFileActionResult,
  SpanLocation,
} from "../../ts-engine/types.js";
import { walkRecursive } from "../../utils/file-walk.js";
import { applyTextEdits, lineColToOffset } from "../../utils/text-utils.js";
import { findTsConfigForFile } from "../../utils/ts-project.js";
import { vueGetTypeErrorsForFile, vueGetTypeErrorsForProject } from "./get-type-errors.js";
import {
  removeVueImportsOfDeletedFile,
  rewriteVueOwnImportsAfterMove,
  updateVueImportsAfterMove,
  updateVueImportsAfterSymbolMove,
} from "./scan.js";
import { buildVolarService, type CachedService } from "./service.js";

export class VolarEngine implements Engine {
  private services = new Map<string, CachedService>();
  private tsEngine: TsMorphEngine;
  private workspaceRoot: string;

  constructor(tsEngine: TsMorphEngine, workspaceRoot = "") {
    this.tsEngine = tsEngine;
    this.workspaceRoot = workspaceRoot;
  }

  private cacheKey(tsConfigPath: string | null, filePath: string): string {
    return tsConfigPath ?? `__no_tsconfig__:${path.dirname(filePath)}`;
  }

  private async getService(filePath: string): Promise<CachedService> {
    const tsConfigPath = findTsConfigForFile(filePath);
    const cacheKey = this.cacheKey(tsConfigPath, filePath);

    let cached = this.services.get(cacheKey);
    if (!cached) {
      cached = await buildVolarService(tsConfigPath, filePath, this.workspaceRoot || undefined);
      this.services.set(cacheKey, cached);
    }
    return cached;
  }

  invalidateService(filePath: string): void {
    const tsConfigPath = findTsConfigForFile(filePath);
    this.services.delete(this.cacheKey(tsConfigPath, filePath));
  }

  // ─── Virtual ↔ real path helpers ──────────────────────────────────────────

  private toVirtualLocation(
    realPath: string,
    pos: number,
    service: CachedService,
  ): { fileName: string; pos: number } {
    if (!realPath.endsWith(".vue")) return { fileName: realPath, pos };

    const virtualPath = `${realPath}.ts`;
    if (!service.vueVirtualToReal.has(virtualPath)) return { fileName: realPath, pos };

    const sourceScript = service.language.scripts.get(realPath);
    if (!sourceScript?.generated) return { fileName: virtualPath, pos };

    const serviceScript = sourceScript.generated.languagePlugin.typescript?.getServiceScript(
      sourceScript.generated.root,
    );
    if (!serviceScript) return { fileName: virtualPath, pos };

    const mapper = service.language.maps.get(serviceScript.code, sourceScript);
    const iter = mapper.toGeneratedLocation(pos);
    const next = iter.next() as IteratorResult<readonly [number, unknown]>;
    if (!next.done) return { fileName: virtualPath, pos: next.value[0] };

    return { fileName: virtualPath, pos };
  }

  private translateSingleLocation(loc: SpanLocation, service: CachedService): SpanLocation | null {
    const realVuePath = service.vueVirtualToReal.get(loc.fileName);
    if (realVuePath === undefined) return loc;

    const sourceScript = service.language.scripts.get(realVuePath);
    if (!sourceScript?.generated) return { fileName: realVuePath, textSpan: loc.textSpan };

    const serviceScript = sourceScript.generated.languagePlugin.typescript?.getServiceScript(
      sourceScript.generated.root,
    );
    if (!serviceScript) return { fileName: realVuePath, textSpan: loc.textSpan };

    const mapper = service.language.maps.get(serviceScript.code, sourceScript);
    const iter = mapper.toSourceLocation(loc.textSpan.start);
    const next = iter.next() as IteratorResult<readonly [number, unknown]>;
    if (!next.done) {
      const [sourceOffset] = next.value;
      return {
        fileName: realVuePath,
        textSpan: { start: sourceOffset, length: loc.textSpan.length },
      };
    }
    // No source mapping — Volar glue code; exclude from results.
    return null;
  }

  private translateLocations(
    rawLocations: readonly SpanLocation[],
    service: CachedService,
  ): SpanLocation[] {
    return rawLocations
      .map((loc) => this.translateSingleLocation(loc, service))
      .filter((loc): loc is SpanLocation => loc !== null);
  }

  // ─── Compiler ─────────────────────────────────────────────────────

  resolveOffset(file: string, line: number, col: number): number {
    const content = fs.readFileSync(file, "utf8");
    try {
      return lineColToOffset(content, line, col);
    } catch {
      throw new EngineError(`Line ${line} out of range in ${file}`, "SYMBOL_NOT_FOUND");
    }
  }

  async getRenameLocations(file: string, offset: number): Promise<SpanLocation[] | null> {
    const service = await this.getService(file);
    // Refresh content so the language service sees any recent edits.
    service.fileContents.set(file, fs.readFileSync(file, "utf8"));

    const { fileName, pos } = this.toVirtualLocation(file, offset, service);
    const rawLocs = service.languageService.findRenameLocations(fileName, pos, false, false, {});
    if (!rawLocs || rawLocs.length === 0) return null;

    return this.translateLocations(rawLocs, service);
  }

  async getReferencesAtPosition(file: string, offset: number): Promise<SpanLocation[] | null> {
    const service = await this.getService(file);
    service.fileContents.set(file, fs.readFileSync(file, "utf8"));

    const { fileName, pos } = this.toVirtualLocation(file, offset, service);
    const rawRefs = service.languageService.getReferencesAtPosition(fileName, pos);
    if (!rawRefs || rawRefs.length === 0) return null;

    return this.translateLocations(rawRefs, service);
  }

  async getFileReferences(file: string): Promise<SpanLocation[] | null> {
    const service = await this.getService(file);

    // For .vue targets, query the virtual .vue.ts path so the TS language
    // service can find references to it in both .ts and .vue files.
    const queryPath = file.endsWith(".vue") ? `${file}.ts` : file;

    const refs = service.baseService.getFileReferences(queryPath);
    if (!refs || refs.length === 0) return null;

    const rawLocs: SpanLocation[] = refs.map((ref) => ({
      fileName: ref.fileName,
      textSpan: { start: ref.textSpan.start, length: ref.textSpan.length },
    }));

    return this.translateLocations(rawLocs, service);
  }

  async getDefinitionAtPosition(
    file: string,
    offset: number,
  ): Promise<DefinitionLocation[] | null> {
    const service = await this.getService(file);
    service.fileContents.set(file, fs.readFileSync(file, "utf8"));

    const { fileName: queryFile, pos: queryPos } = this.toVirtualLocation(file, offset, service);

    const rawDefs = service.languageService.getDefinitionAtPosition(queryFile, queryPos);
    if (!rawDefs || rawDefs.length === 0) return null;

    const symbolName = rawDefs[0].name;
    const defs = this.translateLocations(rawDefs, service);

    return defs.map((def) => ({ ...def, name: symbolName }));
  }

  async getEditsForFileRename(oldPath: string, newPath: string): Promise<FileTextEdit[]> {
    const service = await this.getService(oldPath);
    const edits = service.languageService.getEditsForFileRename(oldPath, newPath, {}, {});

    return edits
      .filter((e) => e.textChanges.length > 0 && !service.vueVirtualToReal.has(e.fileName))
      .map((e) => ({
        fileName: e.fileName,
        textChanges: e.textChanges.map((c) => ({
          span: { start: c.span.start, length: c.span.length },
          newText: c.newText,
        })),
      }));
  }

  readFile(filePath: string): string {
    // Check the service cache first (may already have content loaded by buildService).
    const tsConfigPath = findTsConfigForFile(filePath);
    const cached = this.services.get(this.cacheKey(tsConfigPath, filePath));
    return cached?.fileContents.get(filePath) ?? fs.readFileSync(filePath, "utf8");
  }

  notifyFileWritten(filePath: string, content: string): void {
    const tsConfigPath = findTsConfigForFile(filePath);
    const cached = this.services.get(this.cacheKey(tsConfigPath, filePath));
    if (cached) cached.fileContents.set(filePath, content);
  }

  async moveSymbol(
    sourceFile: string,
    symbolName: string,
    destFile: string,
    scope: WorkspaceScope,
    options?: { force?: boolean },
  ): Promise<void> {
    // Delegate TS work (AST surgery + fallback scan for out-of-project TS/JS files).
    await this.tsEngine.moveSymbol(sourceFile, symbolName, destFile, scope, options);

    // Vue SFC scanning: walk .vue files and rewrite imports in <script> blocks.
    const tsConfig = findTsConfigForFile(sourceFile);
    const searchRoot = tsConfig ? path.dirname(tsConfig) : scope.root;
    updateVueImportsAfterSymbolMove(symbolName, sourceFile, destFile, searchRoot, scope);
  }

  async moveFile(
    oldPath: string,
    newPath: string,
    scope: WorkspaceScope,
  ): Promise<MoveFileActionResult> {
    const result = await tsMoveFile(this.tsEngine, oldPath, newPath, scope);
    this.invalidateService(oldPath);
    const tsConfig = findTsConfigForFile(oldPath);
    const searchRoot = tsConfig ? path.dirname(tsConfig) : scope.root;
    updateVueImportsAfterMove(oldPath, newPath, searchRoot, scope);
    return result;
  }

  async moveDirectory(
    oldPath: string,
    newPath: string,
    scope: WorkspaceScope,
  ): Promise<{ filesMoved: string[] }> {
    const absOld = path.resolve(oldPath);
    const absNew = path.resolve(newPath);

    const allFiles = walkRecursive(absOld);
    const allMappings = allFiles.map((oldFilePath) => ({
      oldFilePath,
      newFilePath: path.join(absNew, path.relative(absOld, oldFilePath)),
    }));
    const vueMappings = allMappings.filter(({ oldFilePath }) => oldFilePath.endsWith(".vue"));

    // Must resolve before the physical move — absOld won't exist after.
    const tsConfig = findTsConfigForFile(absOld);
    const searchRoot = tsConfig ? path.dirname(tsConfig) : scope.root;

    // Use virtual .vue.ts paths: Volar registers .vue files under that form in the TS LS,
    // so real .vue paths return nothing from getEditsForFileRename. Run before the move.
    const vueRenameEdits = await Promise.all(
      vueMappings.map(({ oldFilePath, newFilePath }) =>
        this.getEditsForFileRename(`${oldFilePath}.ts`, `${newFilePath}.ts`),
      ),
    );
    applyRenameEdits(this, mergeFileEdits(vueRenameEdits), scope);

    const result = await this.tsEngine.moveDirectory(absOld, absNew, scope);
    this.invalidateService(absOld);

    for (const { oldFilePath, newFilePath } of allMappings) {
      updateVueImportsAfterMove(oldFilePath, newFilePath, searchRoot, scope);
    }

    // getEditsForFileRename does not cover own-import rewriting for moved .vue files.
    for (const { oldFilePath, newFilePath } of vueMappings) {
      rewriteVueOwnImportsAfterMove(oldFilePath, newFilePath, scope);
    }

    return result;
  }

  async deleteFile(targetFile: string, scope: WorkspaceScope): Promise<DeleteFileActionResult> {
    const { tsDeleteFile } = await import("../../ts-engine/delete-file.js");
    const { importRefsRemoved } = await tsDeleteFile(this.tsEngine, targetFile, scope);

    const workspaceRoot = path.resolve(scope.root);
    const { skipped: vueSkipped, refsRemoved: vueRefs } = removeVueImportsOfDeletedFile(
      targetFile,
      workspaceRoot,
      scope,
    );
    for (const f of vueSkipped) scope.recordSkipped(f);

    return { importRefsRemoved: importRefsRemoved + vueRefs };
  }

  async extractFunction(
    file: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    functionName: string,
    scope: WorkspaceScope,
  ): Promise<ExtractFunctionResult> {
    if (file.endsWith(".vue")) {
      throw new EngineError(
        "extractFunction is not supported for .vue files; use a .ts or .tsx file",
        "NOT_SUPPORTED",
      );
    }
    return this.tsEngine.extractFunction(
      file,
      startLine,
      startCol,
      endLine,
      endCol,
      functionName,
      scope,
    );
  }

  async getTypeErrors(
    file: string | undefined,
    scope: WorkspaceScope,
  ): Promise<GetTypeErrorsResult> {
    if (file !== undefined) {
      if (file.endsWith(".vue")) {
        return vueGetTypeErrorsForFile(file, (f) => this.getService(f));
      }
      // .ts file in a Vue project — delegate to the TS engine.
      return this.tsEngine.getTypeErrors(file, scope);
    }
    // Project-wide: merge TS and Vue errors.
    return vueGetTypeErrorsForProject(this.tsEngine, scope, (f) => this.getService(f));
  }

  async rename(
    file: string,
    line: number,
    col: number,
    newName: string,
    scope: WorkspaceScope,
  ): Promise<RenameResult> {
    const service = await this.getService(file);
    const offset = this.resolveOffset(file, line, col);
    const locs = await this.getRenameLocations(file, offset);

    if (!locs) {
      throw new EngineError(
        `No renameable symbol at line ${line}, col ${col} in ${file}`,
        "SYMBOL_NOT_FOUND",
      );
    }

    const firstLoc = locs[0];
    const firstContent = this.readFile(firstLoc.fileName);
    const oldName = firstContent.slice(
      firstLoc.textSpan.start,
      firstLoc.textSpan.start + firstLoc.textSpan.length,
    );

    const editsByFile = new Map<
      string,
      { span: { start: number; length: number }; newText: string }[]
    >();
    for (const loc of locs) {
      let fileEdits = editsByFile.get(loc.fileName);
      if (!fileEdits) {
        fileEdits = [];
        editsByFile.set(loc.fileName, fileEdits);
      }
      fileEdits.push({ span: loc.textSpan, newText: newName });
    }

    for (const [fileName, edits] of editsByFile) {
      if (!scope.contains(fileName)) {
        scope.recordSkipped(fileName);
        continue;
      }
      const original = this.readFile(fileName);
      const updated = applyTextEdits(original, edits);
      scope.writeFile(fileName, updated);
      service.fileContents.set(fileName, updated);
    }

    return {
      filesModified: scope.modified,
      filesSkipped: scope.skipped,
      symbolName: oldName,
      newName,
      locationCount: locs.length,
    };
  }
}
