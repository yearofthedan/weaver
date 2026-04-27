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
  return { category, code, messageText, start, length: 1, file: undefined };
}

function makeMinimalService(
  virtualPath: string,
  realVuePath: string,
  diagnostics: ts.Diagnostic[],
): CachedService {
  return {
    baseService: {
      getSemanticDiagnostics: () => diagnostics,
    } as unknown as ts.LanguageService,
    languageService: {} as unknown as CachedService["languageService"],
    fileContents: new Map(),
    language: {
      scripts: { get: () => undefined },
      maps: {} as unknown,
    } as unknown as CachedService["language"],
    vueVirtualToReal: new Map([[virtualPath, realVuePath]]),
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
      root: {},
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
  describe("diagnostic category filtering", () => {
    it.each([
      ["Warning", ts.DiagnosticCategory.Warning, 1001],
      ["Suggestion", ts.DiagnosticCategory.Suggestion, 9999],
      ["Message", ts.DiagnosticCategory.Message, 9998],
    ])("excludes %s diagnostic from results", (_, category, code) => {
      const service = makeMinimalService("/project/App.vue.ts", "/project/App.vue", [
        makeDiagnostic(category, code, "non-error", 0),
      ]);
      expect(vueGetTypeErrorsFromService(service)).toHaveLength(0);
    });

    it("excludes diagnostic with no start position", () => {
      const service = makeMinimalService("/project/App.vue.ts", "/project/App.vue", [
        makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "error with no position", undefined),
      ]);
      expect(vueGetTypeErrorsFromService(service)).toHaveLength(0);
    });

    it("returns empty when service has no diagnostics", () => {
      const service = makeMinimalService("/project/App.vue.ts", "/project/App.vue", []);
      expect(vueGetTypeErrorsFromService(service)).toHaveLength(0);
    });
  });

  describe("source map translation", () => {
    const REAL_VUE = "/project/App.vue";
    const VIRTUAL_PATH = `${REAL_VUE}.ts`;

    it("excludes Error diagnostic when translateVirtualOffset returns null (Volar glue code)", () => {
      const service = makeMinimalService(VIRTUAL_PATH, REAL_VUE, [
        makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "type error", 0),
      ]);
      expect(vueGetTypeErrorsFromService(service)).toHaveLength(0);
    });

    it("includes Error diagnostic when source map entry exists", () => {
      const service = makeServiceWithSourceMap(
        VIRTUAL_PATH,
        REAL_VUE,
        [makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "type error", 5)],
        [[5, 0]],
      );
      expect(vueGetTypeErrorsFromService(service)).toEqual([
        { file: REAL_VUE, line: 1, col: 1, code: 2322, message: "type error" },
      ]);
    });

    it("excludes Warning even when source map entry exists", () => {
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

    it("excludes diagnostic with undefined start (start check is the exclusive gate)", () => {
      // Greedy mapper returns a location for any offset, including undefined.
      // This proves d.start===undefined is the only thing excluding it.
      const service = makeGreedyService(VIRTUAL_PATH, REAL_VUE, [
        makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "no position", undefined),
      ]);
      expect(vueGetTypeErrorsFromService(service)).toHaveLength(0);
    });

    it("excludes diagnostic when virtual offset has no source map entry (iterator done)", () => {
      const service = makeServiceWithSourceMap(
        VIRTUAL_PATH,
        REAL_VUE,
        [makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "no mapping", 999)],
        [],
      );
      expect(vueGetTypeErrorsFromService(service)).toHaveLength(0);
    });

    it("uses top-level messageText for DiagnosticMessageChain", () => {
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
      expect(vueGetTypeErrorsFromService(service)[0].message).toBe("outer message");
    });
  });
});

describe("vueGetTypeErrorsForFile", () => {
  it("returns empty for template-only .vue file (early return is the exclusive gate)", async () => {
    const REAL_VUE = "/project/TemplateOnly.vue";
    const VIRTUAL_PATH = `${REAL_VUE}.ts`;
    const base = makeGreedyService(VIRTUAL_PATH, REAL_VUE, [
      makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "template error", 0),
    ]);
    const service: CachedService = { ...base, vueVirtualToReal: new Map() };
    const result = await vueGetTypeErrorsForFile(REAL_VUE, async () => service);
    expect(result).toEqual({ diagnostics: [], errorCount: 0, truncated: false });
  });

  it.each([
    { errorCount: MAX_DIAGNOSTICS + 1, truncated: true },
    { errorCount: MAX_DIAGNOSTICS, truncated: false },
  ])("truncated=$truncated when errorCount=$errorCount", async ({ errorCount, truncated }) => {
    const REAL_VUE = "/project/Test.vue";
    const VIRTUAL_PATH = `${REAL_VUE}.ts`;
    const diagnostics = Array.from({ length: errorCount }, (_, i) =>
      makeDiagnostic(ts.DiagnosticCategory.Error, 2322, `error ${i}`, i),
    );
    const service = makeServiceWithSourceMap(
      VIRTUAL_PATH,
      REAL_VUE,
      diagnostics,
      diagnostics.map((_, i) => [i, 0] as [number, number]),
      "x".repeat(errorCount + 1),
    );
    const result = await vueGetTypeErrorsForFile(REAL_VUE, async () => service);
    expect(result.truncated).toBe(truncated);
    expect(result.diagnostics).toHaveLength(Math.min(errorCount, MAX_DIAGNOSTICS));
    expect(result.errorCount).toBe(errorCount);
  });
});

describe("vueGetTypeErrorsForProject", () => {
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

  it.each([
    { tsCount: 60, vueCount: 41, truncated: true, total: 101 },
    { tsCount: 60, vueCount: 40, truncated: false, total: 100 },
  ])("truncated=$truncated when $tsCount TS + $vueCount Vue = $total", async ({
    tsCount,
    vueCount,
    truncated,
    total,
  }) => {
    const REAL_VUE = "/project/Test.vue";
    const VIRTUAL_PATH = `${REAL_VUE}.ts`;
    const vueDiagnostics = Array.from({ length: vueCount }, (_, i) =>
      makeDiagnostic(ts.DiagnosticCategory.Error, 2322, `vue error ${i}`, i),
    );
    const vueService = makeServiceWithSourceMap(
      VIRTUAL_PATH,
      REAL_VUE,
      vueDiagnostics,
      vueDiagnostics.map((_, i) => [i, 0] as [number, number]),
      "x".repeat(vueCount + 1),
    );
    const scope = { root: "/project" } as unknown as WorkspaceScope;

    const result = await vueGetTypeErrorsForProject(
      makeMockTsEngine(tsCount),
      scope,
      async () => vueService,
    );

    expect(result.truncated).toBe(truncated);
    expect(result.diagnostics).toHaveLength(Math.min(total, MAX_DIAGNOSTICS));
    expect(result.errorCount).toBe(total);
  });
});
