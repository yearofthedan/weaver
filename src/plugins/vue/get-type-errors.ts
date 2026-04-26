import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import type { WorkspaceScope } from "../../domain/workspace-scope.js";
import type { GetTypeErrorsResult, TypeDiagnostic } from "../../operations/types.js";
import type { TsMorphEngine } from "../../ts-engine/engine.js";
import { MAX_DIAGNOSTICS } from "../../ts-engine/get-type-errors.js";
import { offsetToLineCol } from "../../utils/text-utils.js";
import type { CachedService } from "./service.js";

/**
 * Translate a virtual offset in `virtualPath` (e.g. `App.vue.ts`) back to a
 * 1-based line and column in the real `.vue` source. Returns `null` when there
 * is no source map entry (Volar glue code — should be excluded from results).
 */
function translateVirtualOffset(
  virtualOffset: number,
  realVuePath: string,
  service: CachedService,
): { line: number; col: number } | null {
  const sourceScript = service.language.scripts.get(realVuePath);
  if (!sourceScript?.generated) return null;

  const serviceScript = sourceScript.generated.languagePlugin.typescript?.getServiceScript(
    sourceScript.generated.root,
  );
  if (!serviceScript) return null;

  const mapper = service.language.maps.get(serviceScript.code, sourceScript);
  const iter = mapper.toSourceLocation(virtualOffset);
  const next = iter.next() as IteratorResult<readonly [number, unknown]>;
  if (next.done) return null;

  const [sourceOffset] = next.value;
  const realContent = fs.readFileSync(realVuePath, "utf8");
  return offsetToLineCol(realContent, sourceOffset);
}

/**
 * Collect type errors from all virtual `.vue.ts` files registered in `service`.
 * Translates positions back to real `.vue` source coordinates. Virtual-only
 * positions (Volar glue code with no source mapping) are excluded.
 */
export function vueGetTypeErrorsFromService(service: CachedService): TypeDiagnostic[] {
  const diagnostics: TypeDiagnostic[] = [];
  for (const [virtualPath, realVuePath] of service.vueVirtualToReal) {
    const raw = service.baseService.getSemanticDiagnostics(virtualPath);
    for (const d of raw) {
      if (d.category !== ts.DiagnosticCategory.Error) continue;
      if (d.start === undefined) continue;

      const lc = translateVirtualOffset(d.start, realVuePath, service);
      if (!lc) continue; // Volar glue — no source mapping

      const message = typeof d.messageText === "string" ? d.messageText : d.messageText.messageText;
      diagnostics.push({
        file: realVuePath,
        line: lc.line,
        col: lc.col,
        code: d.code,
        message,
      });
    }
  }
  return diagnostics;
}

/**
 * Get type errors for a single `.vue` file via the Volar service.
 */
export async function vueGetTypeErrorsForFile(
  file: string,
  getService: (file: string) => Promise<CachedService>,
): Promise<GetTypeErrorsResult> {
  const service = await getService(file);
  const virtualPath = `${file}.ts`;

  // If the file has no TypeScript service script (e.g. template-only), return empty.
  if (!service.vueVirtualToReal.has(virtualPath)) {
    return { diagnostics: [], errorCount: 0, truncated: false };
  }

  const raw = service.baseService.getSemanticDiagnostics(virtualPath);
  const allDiagnostics: TypeDiagnostic[] = [];

  for (const d of raw) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    if (d.start === undefined) continue;

    const lc = translateVirtualOffset(d.start, file, service);
    if (!lc) continue; // Volar glue — no source mapping

    const message = typeof d.messageText === "string" ? d.messageText : d.messageText.messageText;
    allDiagnostics.push({
      file,
      line: lc.line,
      col: lc.col,
      code: d.code,
      message,
    });
  }

  const truncated = allDiagnostics.length > MAX_DIAGNOSTICS;
  const diagnostics = allDiagnostics.slice(0, MAX_DIAGNOSTICS);
  return { diagnostics, errorCount: allDiagnostics.length, truncated };
}

/**
 * Get type errors for the whole project: TS files via `tsEngine`, Vue files via
 * Volar. Merges results and applies the 100-error cap across the combined total.
 */
export async function vueGetTypeErrorsForProject(
  tsEngine: TsMorphEngine,
  scope: WorkspaceScope,
  getService: (file: string) => Promise<CachedService>,
): Promise<GetTypeErrorsResult> {
  // TS errors first.
  const tsResult = await tsEngine.getTypeErrors(undefined, scope);

  // Build the Volar service using a path *inside* the workspace root so that
  // `findTsConfigForFile` searches from the workspace root itself (not its parent).
  // Using a synthetic child path is safe — `findTsConfigForFile` only needs the
  // directory, not a real file on disk.
  const serviceKey = path.join(scope.root, "_probe.ts");
  const service = await getService(serviceKey);
  const vueDiagnostics = vueGetTypeErrorsFromService(service);

  const allDiagnostics = [...tsResult.diagnostics, ...vueDiagnostics];
  const totalCount = tsResult.errorCount + vueDiagnostics.length;
  const truncated = totalCount > MAX_DIAGNOSTICS;
  const diagnostics = allDiagnostics.slice(0, MAX_DIAGNOSTICS);
  return { diagnostics, errorCount: totalCount, truncated };
}
