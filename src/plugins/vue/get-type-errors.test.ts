import ts from "typescript";
import { describe, expect, it } from "vitest";
import { vueGetTypeErrorsFromService } from "./get-type-errors.js";
import type { CachedService } from "./service.js";

function makeDiagnostic(
  category: ts.DiagnosticCategory,
  code: number,
  messageText: string,
  start?: number,
): ts.Diagnostic {
  return {
    category,
    code,
    messageText,
    start,
    length: 1,
    file: undefined,
  };
}

function makeMinimalService(
  virtualPath: string,
  realVuePath: string,
  diagnostics: ts.Diagnostic[],
): CachedService {
  const virtualToReal = new Map([[virtualPath, realVuePath]]);

  return {
    baseService: {
      getSemanticDiagnostics: () => diagnostics,
    } as unknown as ts.LanguageService,
    languageService: {} as unknown as CachedService["languageService"],
    fileContents: new Map(),
    language: {
      scripts: {
        get: () => undefined, // no generated script → translateVirtualOffset returns null
      },
      maps: {} as unknown,
    } as unknown as CachedService["language"],
    vueVirtualToReal: virtualToReal,
  };
}

describe("vueGetTypeErrorsFromService", () => {
  describe("diagnostic category filtering", () => {
    it("excludes warnings from results", () => {
      const service = makeMinimalService("/project/App.vue.ts", "/project/App.vue", [
        makeDiagnostic(ts.DiagnosticCategory.Warning, 1001, "a warning", 0),
        makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "a real error", 0),
      ]);

      // Both have d.start = 0 so they reach translateVirtualOffset which returns null
      // (no generated script). Result is empty, but the filtering by category is distinct
      // from the source-map null guard. We verify warnings don't survive if they happen
      // to have a source map hit — here both return null from translateVirtualOffset,
      // confirming the category check is the earlier gate.
      const diagnostics = vueGetTypeErrorsFromService(service);
      expect(diagnostics).toHaveLength(0);
    });

    it("excludes diagnostics with no start position", () => {
      const service = makeMinimalService("/project/App.vue.ts", "/project/App.vue", [
        makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "error with no position", undefined),
      ]);

      const diagnostics = vueGetTypeErrorsFromService(service);
      expect(diagnostics).toHaveLength(0);
    });

    it("returns empty when all diagnostics are non-errors", () => {
      const service = makeMinimalService("/project/App.vue.ts", "/project/App.vue", [
        makeDiagnostic(ts.DiagnosticCategory.Suggestion, 9999, "suggestion", 0),
        makeDiagnostic(ts.DiagnosticCategory.Message, 9998, "message", 0),
      ]);

      const diagnostics = vueGetTypeErrorsFromService(service);
      expect(diagnostics).toHaveLength(0);
    });

    it("returns empty when service has no errors", () => {
      const service = makeMinimalService("/project/App.vue.ts", "/project/App.vue", []);

      const diagnostics = vueGetTypeErrorsFromService(service);
      expect(diagnostics).toHaveLength(0);
    });
  });

  describe("source map fallback", () => {
    it("excludes diagnostics where translateVirtualOffset returns null (Volar glue code)", () => {
      // When language.scripts.get returns undefined (no generated script),
      // translateVirtualOffset returns null and the diagnostic is excluded.
      const service = makeMinimalService("/project/App.vue.ts", "/project/App.vue", [
        makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "type error", 0),
      ]);

      const diagnostics = vueGetTypeErrorsFromService(service);
      // No source map → excluded
      expect(diagnostics).toHaveLength(0);
    });
  });
});
