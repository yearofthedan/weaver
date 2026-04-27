import * as path from "node:path";
import ts from "typescript";
import type { WorkspaceScope } from "../../domain/workspace-scope.js";
import type { GetTypeErrorsResult, TypeDiagnostic } from "../../operations/types.js";
import { MAX_DIAGNOSTICS } from "../../operations/types.js";
import type { TsMorphEngine } from "../../ts-engine/engine.js";
import { extractDiagnosticMessage } from "../../ts-engine/get-type-errors.js";
import { offsetToLineCol } from "../../utils/text-utils.js";
import type { CachedService } from "./service.js";

// Returns null when there is no source map entry (Volar glue code with no mapping to .vue source).
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
  const realContent = service.fileContents.get(realVuePath);
  if (!realContent) return null;
  return offsetToLineCol(realContent, sourceOffset);
}

function translateDiagnostics(
  raw: ReturnType<ts.LanguageService["getSemanticDiagnostics"]>,
  realVuePath: string,
  service: CachedService,
): TypeDiagnostic[] {
  const diagnostics: TypeDiagnostic[] = [];
  for (const d of raw) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    if (d.start === undefined) continue;
    const lc = translateVirtualOffset(d.start, realVuePath, service);
    if (!lc) continue;
    diagnostics.push({
      file: realVuePath,
      line: lc.line,
      col: lc.col,
      code: d.code,
      message: extractDiagnosticMessage(d.messageText),
    });
  }
  return diagnostics;
}

export function vueGetTypeErrorsFromService(service: CachedService): TypeDiagnostic[] {
  const diagnostics: TypeDiagnostic[] = [];
  for (const [virtualPath, realVuePath] of service.vueVirtualToReal) {
    diagnostics.push(
      ...translateDiagnostics(
        service.baseService.getSemanticDiagnostics(virtualPath),
        realVuePath,
        service,
      ),
    );
  }
  return diagnostics;
}

export async function vueGetTypeErrorsForFile(
  file: string,
  getService: (file: string) => Promise<CachedService>,
): Promise<GetTypeErrorsResult> {
  const service = await getService(file);
  const virtualPath = `${file}.ts`;

  if (!service.vueVirtualToReal.has(virtualPath)) {
    return { diagnostics: [], errorCount: 0, truncated: false };
  }

  const raw = service.baseService.getSemanticDiagnostics(virtualPath);
  const allDiagnostics = translateDiagnostics(raw, file, service);
  const truncated = allDiagnostics.length > MAX_DIAGNOSTICS;
  const diagnostics = allDiagnostics.slice(0, MAX_DIAGNOSTICS);
  return { diagnostics, errorCount: allDiagnostics.length, truncated };
}

export async function vueGetTypeErrorsForProject(
  tsEngine: TsMorphEngine,
  scope: WorkspaceScope,
  getService: (file: string) => Promise<CachedService>,
): Promise<GetTypeErrorsResult> {
  const tsResult = await tsEngine.getTypeErrors(undefined, scope);

  // Synthetic child path to anchor findTsConfigForFile at the workspace root, not its parent.
  const serviceKey = path.join(scope.root, "_probe.ts");
  const service = await getService(serviceKey);
  const vueDiagnostics = vueGetTypeErrorsFromService(service);

  const allDiagnostics = [...tsResult.diagnostics, ...vueDiagnostics];
  const totalCount = tsResult.errorCount + vueDiagnostics.length;
  const truncated = totalCount > MAX_DIAGNOSTICS;
  const diagnostics = allDiagnostics.slice(0, MAX_DIAGNOSTICS);
  return { diagnostics, errorCount: totalCount, truncated };
}
