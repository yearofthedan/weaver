import * as fs from "node:fs";
import * as path from "node:path";
import { EngineError } from "../errors.js";
import type {
  DefinitionLocation,
  FileTextEdit,
  LanguageProvider,
  SpanLocation,
} from "../types.js";
import { findTsConfigForFile } from "../ts/project.js";
import { type CachedService, buildVolarService } from "../vue/service-builder.js";
import { updateVueImportsAfterMove } from "../vue/scan.js";

export class VolarProvider implements LanguageProvider {
  private services = new Map<string, CachedService>();

  private async getService(filePath: string): Promise<CachedService> {
    const tsConfigPath = findTsConfigForFile(filePath);
    const cacheKey = tsConfigPath ?? `__no_tsconfig__:${path.dirname(filePath)}`;

    let cached = this.services.get(cacheKey);
    if (!cached) {
      cached = await buildVolarService(tsConfigPath, filePath);
      this.services.set(cacheKey, cached);
    }
    return cached;
  }

  invalidateService(filePath: string): void {
    const tsConfigPath = findTsConfigForFile(filePath);
    this.services.delete(tsConfigPath ?? `__no_tsconfig__:${path.dirname(filePath)}`);
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

  private translateLocations(
    rawLocations: readonly { fileName: string; textSpan: { start: number; length: number } }[],
    service: CachedService,
  ): { fileName: string; textSpan: { start: number; length: number } }[] {
    const locations: { fileName: string; textSpan: { start: number; length: number } }[] = [];
    for (const loc of rawLocations) {
      const realVuePath = service.vueVirtualToReal.get(loc.fileName);
      if (realVuePath === undefined) {
        locations.push(loc);
        continue;
      }

      const sourceScript = service.language.scripts.get(realVuePath);
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

      const mapper = service.language.maps.get(serviceScript.code, sourceScript);
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

  // ─── LanguageProvider ─────────────────────────────────────────────────────

  resolveOffset(file: string, line: number, col: number): number {
    // Pure string arithmetic — no service needed.
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    if (line - 1 >= lines.length) {
      throw new EngineError(`Line ${line} out of range in ${file}`, "SYMBOL_NOT_FOUND");
    }
    let offset = 0;
    for (let i = 0; i < line - 1; i++) {
      offset += lines[i].length + 1; // +1 for \n
    }
    return offset + col - 1;
  }

  async getRenameLocations(file: string, offset: number): Promise<SpanLocation[] | null> {
    const service = await this.getService(file);
    // Refresh content so the language service sees any recent edits.
    service.fileContents.set(file, fs.readFileSync(file, "utf8"));

    const rawLocs = service.languageService.findRenameLocations(file, offset, false, false, {});
    if (!rawLocs || rawLocs.length === 0) return null;

    return this.translateLocations(rawLocs, service);
  }

  async getReferencesAtPosition(file: string, offset: number): Promise<SpanLocation[] | null> {
    const service = await this.getService(file);
    service.fileContents.set(file, fs.readFileSync(file, "utf8"));

    const rawRefs = service.languageService.getReferencesAtPosition(file, offset);
    if (!rawRefs || rawRefs.length === 0) return null;

    return this.translateLocations(rawRefs, service);
  }

  async getDefinitionAtPosition(
    file: string,
    offset: number,
  ): Promise<DefinitionLocation[] | null> {
    const service = await this.getService(file);
    service.fileContents.set(file, fs.readFileSync(file, "utf8"));

    // getDefinitionAtPosition does not auto-translate .vue → .vue.ts the way
    // findRenameLocations / getReferencesAtPosition do, so we translate first.
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
    const cacheKey = tsConfigPath ?? `__no_tsconfig__:${path.dirname(filePath)}`;
    const cached = this.services.get(cacheKey);
    return cached?.fileContents.get(filePath) ?? fs.readFileSync(filePath, "utf8");
  }

  notifyFileWritten(filePath: string, content: string): void {
    const tsConfigPath = findTsConfigForFile(filePath);
    const cacheKey = tsConfigPath ?? `__no_tsconfig__:${path.dirname(filePath)}`;
    const cached = this.services.get(cacheKey);
    if (cached) cached.fileContents.set(filePath, content);
  }

  async afterFileRename(
    oldPath: string,
    newPath: string,
    _workspace: string,
  ): Promise<{ modified: string[]; skipped: string[] }> {
    this.invalidateService(oldPath);

    const tsConfig = findTsConfigForFile(oldPath);
    const searchRoot = tsConfig ? path.dirname(tsConfig) : path.dirname(oldPath);
    const modified = updateVueImportsAfterMove(oldPath, newPath, searchRoot);

    return { modified, skipped: [] };
  }
}
