import ts from "typescript";
import type { GetTypeErrorsResult, TypeDiagnostic } from "../../operations/types.js";
import { MAX_DIAGNOSTICS } from "../../operations/types.js";
import {
  capDiagnostics,
  extractDiagnosticMessage,
  semanticErrors,
} from "../../ts-engine/get-type-errors.js";
import { typeCheckedFiles } from "../../ts-engine/type-check-scope.js";
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
  return capDiagnostics(semanticErrors(service.baseService, file));
}

/**
 * Project-wide type errors for a Vue project, answered entirely by the Volar
 * service: `.vue` files through `vueGetTypeErrorsFromService`, everything else
 * through `baseService` directly (no source-map translation needed — see
 * `vueGetTypeErrorsForTsFile`). The plain-`.ts`/`.js` set walks `typeCheckedFiles`'
 * closure directly rather than filtering `service.scriptFileNames` — the closure
 * can reach a file the workspace walk never added (e.g. a `node_modules`
 * dependency's own `.d.ts`, when `skipLibCheck` is off), and filtering a set that
 * never contained it would silently drop it. `.vue` entries surfaced by the
 * closure are skipped here: every `.vue` entry the service knows about already
 * came from the tsconfig program or the on-disk SFC scan, and is handled by
 * `vueGetTypeErrorsFromService` instead.
 */
export async function vueGetTypeErrorsForProject(
  getService: (file: undefined) => Promise<CachedService>,
): Promise<GetTypeErrorsResult> {
  const service = await getService(undefined);

  // Only a syntax-only service returns undefined here, and Volar never builds one.
  const program = service.baseService.getProgram() as ts.Program;
  const checked = typeCheckedFiles(
    service.seedFileNames,
    service.seedFileNames === null ? service.scriptFileNames : [],
    program,
  );

  const errors: ts.Diagnostic[] = [];
  for (const fileName of checked) {
    // .vue entries are virtual (`Foo.vue.ts`) and handled below, where their
    // offsets are mapped back through the source map to the real .vue file.
    if (service.vueVirtualToReal.has(fileName)) continue;
    // getSemanticDiagnostics throws for a path outside the compiled program, and the
    // workspace walk deliberately adds files the program excludes (.js with allowJs
    // unset) so that a move can still repoint their imports.
    if (!program.getSourceFile(fileName)) continue;
    errors.push(...semanticErrors(service.baseService, fileName));
  }

  const tsResult = capDiagnostics(errors);
  const vueDiagnostics = vueGetTypeErrorsFromService(service);

  const allDiagnostics = [...tsResult.diagnostics, ...vueDiagnostics];
  const totalCount = tsResult.errorCount + vueDiagnostics.length;
  const truncated = totalCount > MAX_DIAGNOSTICS;
  const diagnostics = allDiagnostics.slice(0, MAX_DIAGNOSTICS);
  return { diagnostics, errorCount: totalCount, truncated };
}
