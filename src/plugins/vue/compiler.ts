import * as fs from "node:fs";
import * as path from "node:path";
import { ImportRewriter } from "../../domain/import-rewriter.js";
import type { WorkspaceScope } from "../../domain/workspace-scope.js";
import type { TsMorphEngine } from "../../ts-engine/engine.js";
import { tsMoveFile } from "../../ts-engine/move-file.js";
import type {
  DefinitionLocation,
  DeleteFileActionResult,
  Engine,
  FileTextEdit,
  MoveFileActionResult,
  SpanLocation,
} from "../../ts-engine/types.js";
import { EngineError } from "../../utils/errors.js";
import { walkFiles } from "../../utils/file-walk.js";
import { lineColToOffset } from "../../utils/text-utils.js";
import { findTsConfigForFile } from "../../utils/ts-project.js";
import { removeVueImportsOfDeletedFile, updateVueImportsAfterMove } from "./scan.js";
import { buildVolarService, type CachedService } from "./service.js";

export class VolarCompiler implements Engine {
  private services = new Map<string, CachedService>();
  private tsEngine: TsMorphEngine;

  constructor(tsEngine: TsMorphEngine) {
    this.tsEngine = tsEngine;
  }

  private cacheKey(tsConfigPath: string | null, filePath: string): string {
    return tsConfigPath ?? `__no_tsconfig__:${path.dirname(filePath)}`;
  }

  private async getService(filePath: string): Promise<CachedService> {
    const tsConfigPath = findTsConfigForFile(filePath);
    const cacheKey = this.cacheKey(tsConfigPath, filePath);

    let cached = this.services.get(cacheKey);
    if (!cached) {
      cached = await buildVolarService(tsConfigPath, filePath);
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

  async afterSymbolMove(
    sourceFile: string,
    symbolName: string,
    destFile: string,
    scope: WorkspaceScope,
  ): Promise<void> {
    const tsConfig = findTsConfigForFile(sourceFile);
    const searchRoot = tsConfig ? path.dirname(tsConfig) : scope.root;
    const rewriter = new ImportRewriter();
    const SCRIPT_BLOCK = /(<script[^>]*>)([\s\S]*?)(<\/script>)/;

    const alreadyModified = new Set(scope.modified);
    for (const vueFile of walkFiles(searchRoot, [".vue"])) {
      if (alreadyModified.has(vueFile)) continue;

      const fileContent = scope.fs.readFile(vueFile);
      const match = SCRIPT_BLOCK.exec(fileContent);
      if (!match) continue;

      const [, openTag, scriptContent, closeTag] = match;
      const rewritten = rewriter.rewriteScript(
        vueFile,
        scriptContent,
        symbolName,
        sourceFile,
        destFile,
        scope,
      );
      if (rewritten !== null) {
        scope.writeFile(
          vueFile,
          fileContent.replace(SCRIPT_BLOCK, `${openTag}${rewritten}${closeTag}`),
        );
      }
    }
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
    const result = await this.tsEngine.moveDirectory(oldPath, newPath, scope);
    this.invalidateService(oldPath);
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
}
