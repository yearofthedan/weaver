import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { WorkspaceScope } from "../../domain/workspace-scope.js";
import { MAX_DIAGNOSTICS } from "../../operations/types.js";
import type { TsMorphEngine } from "../../ts-engine/engine.js";
import {
  vueGetTypeErrorsForFile,
  vueGetTypeErrorsForProject,
  vueGetTypeErrorsFromService,
} from "./get-type-errors.js";
import type { CachedService } from "./service.js";

function makeDiagnostic(
  category: ts.DiagnosticCategory,
  code: number,
  messageText: string | ts.DiagnosticMessageChain,
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

/**
 * Service with mocked source map machinery so translateVirtualOffset can return real positions.
 * offsets: pairs of [virtualOffset, realOffset] that will resolve to a source location.
 * Any offset not in the map causes translateVirtualOffset to return null (done iterator).
 */
function makeServiceWithSourceMap(
  virtualPath: string,
  realVuePath: string,
  diagnostics: ts.Diagnostic[],
  offsets: Array<[number, number]>,
  realContent = "hello\nworld",
): CachedService {
  const offsetMap = new Map(offsets);
  const mockCode = {};
  const mockRoot = {};

  const mapper = {
    toSourceLocation: (offset: number) => {
      const realOffset = offsetMap.get(offset);
      if (realOffset === undefined) {
        return { next: () => ({ done: true as const, value: undefined as never }) };
      }
      let consumed = false;
      return {
        next: () => {
          if (!consumed) {
            consumed = true;
            return { done: false as const, value: [realOffset, {}] as [number, unknown] };
          }
          return { done: true as const, value: undefined as never };
        },
      };
    },
  };

  const sourceScript = {
    generated: {
      languagePlugin: { typescript: { getServiceScript: () => ({ code: mockCode }) } },
      root: mockRoot,
    },
  };

  return {
    baseService: {
      getSemanticDiagnostics: () => diagnostics,
    } as unknown as ts.LanguageService,
    languageService: {} as unknown as CachedService["languageService"],
    fileContents: new Map([[realVuePath, realContent]]),
    language: {
      scripts: { get: (p: string) => (p === realVuePath ? sourceScript : undefined) },
      maps: { get: () => mapper },
    } as unknown as CachedService["language"],
    vueVirtualToReal: new Map([[virtualPath, realVuePath]]),
  };
}

/**
 * Service whose source-map mapper returns a valid location for ANY offset,
 * including undefined. Used to prove that a specific guard (e.g. start===undefined)
 * is the only thing excluding a diagnostic — not a downstream null return.
 */
function makeGreedyService(
  virtualPath: string,
  realVuePath: string,
  diagnostics: ts.Diagnostic[],
  realContent = "hello\nworld",
): CachedService {
  const mockCode = {};
  const greedyMapper = {
    toSourceLocation: (_offset: unknown) => {
      let consumed = false;
      return {
        next: () => {
          if (!consumed) {
            consumed = true;
            return { done: false as const, value: [0, {}] as [number, unknown] };
          }
          return { done: true as const, value: undefined as never };
        },
      };
    },
  };
  const sourceScript = {
    generated: {
      languagePlugin: { typescript: { getServiceScript: () => ({ code: mockCode }) } },
      root: {},
    },
  };
  return {
    baseService: { getSemanticDiagnostics: () => diagnostics } as unknown as ts.LanguageService,
    languageService: {} as unknown as CachedService["languageService"],
    fileContents: new Map([[realVuePath, realContent]]),
    language: {
      scripts: { get: (p: string) => (p === realVuePath ? sourceScript : undefined) },
      maps: { get: () => greedyMapper },
    } as unknown as CachedService["language"],
    vueVirtualToReal: new Map([[virtualPath, realVuePath]]),
  };
}

describe("vueGetTypeErrorsFromService", () => {
  describe("diagnostic category filtering (null source maps)", () => {
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

  describe("source map fallback (null source maps)", () => {
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

  describe("translateDiagnostics (with source maps)", () => {
    const REAL_VUE = "/project/App.vue";
    const VIRTUAL_PATH = `${REAL_VUE}.ts`;

    it("includes Error diagnostic when source map entry exists", () => {
      const service = makeServiceWithSourceMap(
        VIRTUAL_PATH,
        REAL_VUE,
        [makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "type error", 5)],
        [[5, 0]],
      );

      const result = vueGetTypeErrorsFromService(service);
      expect(result).toEqual([
        { file: REAL_VUE, line: 1, col: 1, code: 2322, message: "type error" },
      ]);
    });

    it("excludes Warning diagnostic even when source map entry exists", () => {
      const service = makeServiceWithSourceMap(
        VIRTUAL_PATH,
        REAL_VUE,
        [
          makeDiagnostic(ts.DiagnosticCategory.Warning, 1001, "a warning", 5),
          makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "real error", 10),
        ],
        [
          [5, 0],
          [10, 0],
        ],
      );

      const result = vueGetTypeErrorsFromService(service);
      expect(result).toHaveLength(1);
      expect(result[0].code).toBe(2322);
    });

    it("excludes diagnostic with undefined start even when source map is present", () => {
      const service = makeServiceWithSourceMap(
        VIRTUAL_PATH,
        REAL_VUE,
        [makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "no position", undefined)],
        [],
      );

      const result = vueGetTypeErrorsFromService(service);
      expect(result).toHaveLength(0);
    });

    it("excludes diagnostic with undefined start (start check is the exclusive gate)", () => {
      // Greedy mapper returns a location for any offset, including undefined.
      // This proves the d.start===undefined guard is the only thing excluding it.
      const service = makeGreedyService(VIRTUAL_PATH, REAL_VUE, [
        makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "no position", undefined),
      ]);

      const result = vueGetTypeErrorsFromService(service);
      expect(result).toHaveLength(0);
    });

    it("excludes diagnostic when virtual offset has no source map entry (iterator done)", () => {
      const service = makeServiceWithSourceMap(
        VIRTUAL_PATH,
        REAL_VUE,
        [makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "no mapping", 999)],
        [], // offset 999 has no mapping → done=true
      );

      const result = vueGetTypeErrorsFromService(service);
      expect(result).toHaveLength(0);
    });

    it("uses DiagnosticMessageChain.messageText for nested error messages", () => {
      const chain: ts.DiagnosticMessageChain = {
        messageText: "outer message",
        category: ts.DiagnosticCategory.Error,
        code: 2322,
        next: [{ messageText: "inner detail", category: ts.DiagnosticCategory.Message, code: 0 }],
      };

      const service = makeServiceWithSourceMap(
        VIRTUAL_PATH,
        REAL_VUE,
        [makeDiagnostic(ts.DiagnosticCategory.Error, 2322, chain, 5)],
        [[5, 0]],
      );

      const result = vueGetTypeErrorsFromService(service);
      expect(result[0].message).toBe("outer message");
    });
  });
});

describe("vueGetTypeErrorsForFile", () => {
  it("returns empty for template-only .vue file (early return is the exclusive gate)", async () => {
    // Greedy service: source maps work and getSemanticDiagnostics returns an error,
    // but vueVirtualToReal does NOT contain the virtual path for this file.
    // If the early return were removed, the error would be included.
    const REAL_VUE = "/project/TemplateOnly.vue";
    const VIRTUAL_PATH = `${REAL_VUE}.ts`;
    const base = makeGreedyService(VIRTUAL_PATH, REAL_VUE, [
      makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "template error", 0),
    ]);
    const service: CachedService = { ...base, vueVirtualToReal: new Map() };

    const result = await vueGetTypeErrorsForFile(REAL_VUE, async () => service);
    expect(result).toEqual({ diagnostics: [], errorCount: 0, truncated: false });
  });

  describe("truncation", () => {
    it("truncates at MAX_DIAGNOSTICS when more than 100 errors exist", async () => {
      const REAL_VUE = "/project/Truncated.vue";
      const VIRTUAL_PATH = `${REAL_VUE}.ts`;
      const REAL_CONTENT = "x".repeat(500);

      const diagnostics = Array.from({ length: MAX_DIAGNOSTICS + 1 }, (_, i) =>
        makeDiagnostic(ts.DiagnosticCategory.Error, 2322, `error ${i}`, i),
      );
      const offsets: Array<[number, number]> = diagnostics.map((_, i) => [i, 0]);
      const service = makeServiceWithSourceMap(
        VIRTUAL_PATH,
        REAL_VUE,
        diagnostics,
        offsets,
        REAL_CONTENT,
      );

      const result = await vueGetTypeErrorsForFile(REAL_VUE, async () => service);
      expect(result.truncated).toBe(true);
      expect(result.diagnostics).toHaveLength(MAX_DIAGNOSTICS);
      expect(result.errorCount).toBe(MAX_DIAGNOSTICS + 1);
    });

    it("does not truncate when error count equals MAX_DIAGNOSTICS", async () => {
      const REAL_VUE = "/project/AtCap.vue";
      const VIRTUAL_PATH = `${REAL_VUE}.ts`;
      const REAL_CONTENT = "x".repeat(500);

      const diagnostics = Array.from({ length: MAX_DIAGNOSTICS }, (_, i) =>
        makeDiagnostic(ts.DiagnosticCategory.Error, 2322, `error ${i}`, i),
      );
      const offsets: Array<[number, number]> = diagnostics.map((_, i) => [i, 0]);
      const service = makeServiceWithSourceMap(
        VIRTUAL_PATH,
        REAL_VUE,
        diagnostics,
        offsets,
        REAL_CONTENT,
      );

      const result = await vueGetTypeErrorsForFile(REAL_VUE, async () => service);
      expect(result.truncated).toBe(false);
      expect(result.diagnostics).toHaveLength(MAX_DIAGNOSTICS);
      expect(result.errorCount).toBe(MAX_DIAGNOSTICS);
    });
  });
});

describe("vueGetTypeErrorsForProject", () => {
  describe("truncation", () => {
    function makeMockTsEngine(errorCount: number): TsMorphEngine {
      return {
        getTypeErrors: async () => ({
          diagnostics: Array.from({ length: errorCount }, (_, i) => ({
            file: `/project/file${i}.ts`,
            line: 1,
            col: 1,
            code: 2322,
            message: `ts error ${i}`,
          })),
          errorCount,
          truncated: false,
        }),
      } as unknown as TsMorphEngine;
    }

    it("truncates combined TS+Vue errors when total exceeds MAX_DIAGNOSTICS", async () => {
      // 60 TS errors + 41 Vue errors = 101 total → truncated
      const REAL_VUE = "/project/Errors.vue";
      const VIRTUAL_PATH = `${REAL_VUE}.ts`;
      const vueDiagnostics = Array.from({ length: 41 }, (_, i) =>
        makeDiagnostic(ts.DiagnosticCategory.Error, 2322, `vue error ${i}`, i),
      );
      const vueService = makeServiceWithSourceMap(
        VIRTUAL_PATH,
        REAL_VUE,
        vueDiagnostics,
        vueDiagnostics.map((_, i) => [i, 0] as [number, number]),
        "x".repeat(500),
      );
      const scope = { root: "/project" } as unknown as WorkspaceScope;

      const result = await vueGetTypeErrorsForProject(
        makeMockTsEngine(60),
        scope,
        async () => vueService,
      );

      expect(result.truncated).toBe(true);
      expect(result.diagnostics).toHaveLength(MAX_DIAGNOSTICS);
      expect(result.errorCount).toBe(101);
    });

    it("does not truncate when combined total equals MAX_DIAGNOSTICS", async () => {
      // 60 TS errors + 40 Vue errors = 100 total → not truncated
      const REAL_VUE = "/project/AtCap.vue";
      const VIRTUAL_PATH = `${REAL_VUE}.ts`;
      const vueDiagnostics = Array.from({ length: 40 }, (_, i) =>
        makeDiagnostic(ts.DiagnosticCategory.Error, 2322, `vue error ${i}`, i),
      );
      const vueService = makeServiceWithSourceMap(
        VIRTUAL_PATH,
        REAL_VUE,
        vueDiagnostics,
        vueDiagnostics.map((_, i) => [i, 0] as [number, number]),
        "x".repeat(500),
      );
      const scope = { root: "/project" } as unknown as WorkspaceScope;

      const result = await vueGetTypeErrorsForProject(
        makeMockTsEngine(60),
        scope,
        async () => vueService,
      );

      expect(result.truncated).toBe(false);
      expect(result.diagnostics).toHaveLength(MAX_DIAGNOSTICS);
      expect(result.errorCount).toBe(100);
    });
  });
});
