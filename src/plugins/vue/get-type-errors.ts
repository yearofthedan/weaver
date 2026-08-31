import ts from "typescript";
import type { GetTypeErrorsResult, TypeDiagnostic } from "../../operations/types.js";
import { MAX_DIAGNOSTICS } from "../../operations/types.js";
import { extractDiagnosticMessage, toDiagnostic } from "../../ts-engine/get-type-errors.js";
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

/**
 * Type errors for a non-`.vue` file (`.ts`, `.tsx`, `.js` with `allowJs`) in a
 * Vue project, answered by the Volar service the engine already holds rather
 * than a separate ts-morph project — the ts-morph project has no `.vue`
 * language support, so it cannot resolve a `.vue` specifier and would report a
 * false "cannot find module" for every import of one. Diagnostics for a
 * non-`.vue` file carry a real `d.file`, so `toDiagnostic` maps them directly —
 * no source-map translation, unlike the `.vue` path above.
 */
export async function vueGetTypeErrorsForTsFile(
  file: string,
  getService: (file: string) => Promise<CachedService>,
): Promise<GetTypeErrorsResult> {
  const service = await getService(file);
  const raw = service.baseService.getSemanticDiagnostics(file);
  const errors = raw.filter((d) => d.category === ts.DiagnosticCategory.Error);
  const truncated = errors.length > MAX_DIAGNOSTICS;
  const diagnostics = errors.slice(0, MAX_DIAGNOSTICS).map(toDiagnostic);
  return { diagnostics, errorCount: errors.length, truncated };
}

/**
 * Project-wide type errors for a Vue project, answered entirely by the Volar
 * service: `.vue` files through `vueGetTypeErrorsFromService`, everything else
 * through `baseService` directly (no source-map translation needed — see
 * `vueGetTypeErrorsForTsFile`). Iteration is constrained to
 * `service.scriptFileNames` — the tsconfig's own file list — rather than the
 * host's full script set, which `buildVolarService` deliberately widens with
 * every workspace TS/JS file for rename and find-references; iterating that
 * wider set here would report errors in files the tsconfig excludes.
 */
export async function vueGetTypeErrorsForProject(
  getService: (file: undefined) => Promise<CachedService>,
): Promise<GetTypeErrorsResult> {
  const service = await getService(undefined);
  const vueDiagnostics = vueGetTypeErrorsFromService(service);

  const tsDiagnostics: TypeDiagnostic[] = [];
  let tsErrorCount = 0;
  for (const fileName of service.scriptFileNames) {
    // .vue entries are virtual (`Foo.vue.ts`) and already covered above.
    if (service.vueVirtualToReal.has(fileName)) continue;
    const raw = service.baseService.getSemanticDiagnostics(fileName);
    const errors = raw.filter((d) => d.category === ts.DiagnosticCategory.Error);
    tsErrorCount += errors.length;
    tsDiagnostics.push(...errors.map(toDiagnostic));
  }

  const allDiagnostics = [...tsDiagnostics, ...vueDiagnostics];
  const totalCount = tsErrorCount + vueDiagnostics.length;
  const truncated = totalCount > MAX_DIAGNOSTICS;
  const diagnostics = allDiagnostics.slice(0, MAX_DIAGNOSTICS);
  return { diagnostics, errorCount: totalCount, truncated };
}
