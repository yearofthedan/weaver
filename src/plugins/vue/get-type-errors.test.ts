import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { MAX_DIAGNOSTICS } from "../../operations/types.js";
import {
  vueGetTypeErrorsForFile,
  vueGetTypeErrorsForProject,
  vueGetTypeErrorsForTsFile,
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

/** A diagnostic carrying a real `ts.SourceFile`, the shape a .ts file's own diagnostics have. */
function makeTsFileDiagnostic(
  category: ts.DiagnosticCategory,
  code: number,
  messageText: string,
  fileName: string,
  content: string,
  start: number,
): ts.Diagnostic {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  return { category, code, messageText, start, length: 1, file: sourceFile };
}

/**
 * Defaults every `CachedService` field to an inert, no-tsconfig shape so each
 * call site only states what makes it different — a field neither state
 * pastes into every factory nor a later override can silently drift from.
 */
function makeBaseCachedService(overrides: Partial<CachedService> = {}): CachedService {
  return {
    baseService: {} as unknown as ts.LanguageService,
    languageService: {} as unknown as CachedService["languageService"],
    fileContents: new Map(),
    language: {
      scripts: { get: () => undefined },
      maps: {} as unknown,
    } as unknown as CachedService["language"],
    vueVirtualToReal: new Map(),
    scriptFileNames: [],
    seedFileNames: null,
    ...overrides,
  };
}

function makeMinimalService(
  virtualPath: string,
  realVuePath: string,
  diagnostics: ts.Diagnostic[],
): CachedService {
  return makeBaseCachedService({
    baseService: {
      getSemanticDiagnostics: () => diagnostics,
      getProgram: () => ({ getSourceFile: () => ({}) }),
    } as unknown as ts.LanguageService,
    vueVirtualToReal: new Map([[virtualPath, realVuePath]]),
    scriptFileNames: [virtualPath],
  });
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

  return makeBaseCachedService({
    baseService: {
      getSemanticDiagnostics: () => diagnostics,
    } as unknown as ts.LanguageService,
    fileContents: new Map([[realVuePath, realContent]]),
    language: {
      scripts: { get: (p: string) => (p === realVuePath ? sourceScript : undefined) },
      maps: { get: () => mapper },
    } as unknown as CachedService["language"],
    vueVirtualToReal: new Map([[virtualPath, realVuePath]]),
    scriptFileNames: [virtualPath],
  });
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
  return makeBaseCachedService({
    baseService: { getSemanticDiagnostics: () => diagnostics } as unknown as ts.LanguageService,
    fileContents: new Map([[realVuePath, realContent]]),
    language: {
      scripts: { get: (p: string) => (p === realVuePath ? sourceScript : undefined) },
      maps: { get: () => greedyMapper },
    } as unknown as CachedService["language"],
    vueVirtualToReal: new Map([[virtualPath, realVuePath]]),
    scriptFileNames: [virtualPath],
  });
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

describe("vueGetTypeErrorsForTsFile", () => {
  function makeTsFileService(diagnostics: ts.Diagnostic[]): CachedService {
    // No .vue entries: the non-.vue path must not consult the virtual-path map.
    return {
      ...makeMinimalService("unused.vue.ts", "unused.vue", diagnostics),
      vueVirtualToReal: new Map(),
      scriptFileNames: [],
    };
  }

  it("maps a diagnostic directly from d.file — no source-map translation", async () => {
    const FILE = "/project/main.ts";
    const CONTENT = "import Widget from '@/components/Widget.vue';\n";
    const service = makeTsFileService([
      makeTsFileDiagnostic(
        ts.DiagnosticCategory.Error,
        2307,
        "Cannot find module",
        FILE,
        CONTENT,
        20,
      ),
    ]);
    const result = await vueGetTypeErrorsForTsFile(FILE, async () => service);
    expect(result).toEqual({
      diagnostics: [{ file: FILE, line: 1, col: 21, code: 2307, message: "Cannot find module" }],
      errorCount: 1,
      truncated: false,
    });
  });

  it("excludes non-Error diagnostics", async () => {
    const FILE = "/project/main.ts";
    const CONTENT = "const x = 1;\n";
    const service = makeTsFileService([
      makeTsFileDiagnostic(ts.DiagnosticCategory.Warning, 1001, "a warning", FILE, CONTENT, 0),
      makeTsFileDiagnostic(
        ts.DiagnosticCategory.Suggestion,
        9999,
        "a suggestion",
        FILE,
        CONTENT,
        0,
      ),
    ]);
    const result = await vueGetTypeErrorsForTsFile(FILE, async () => service);
    expect(result).toEqual({ diagnostics: [], errorCount: 0, truncated: false });
  });

  it("returns empty when the service reports no diagnostics", async () => {
    const service = makeTsFileService([]);
    const result = await vueGetTypeErrorsForTsFile("/project/clean.ts", async () => service);
    expect(result).toEqual({ diagnostics: [], errorCount: 0, truncated: false });
  });

  it.each([
    { errorCount: MAX_DIAGNOSTICS + 1, truncated: true },
    { errorCount: MAX_DIAGNOSTICS, truncated: false },
  ])("truncated=$truncated when errorCount=$errorCount", async ({ errorCount, truncated }) => {
    const FILE = "/project/many.ts";
    const CONTENT = "x".repeat(errorCount + 1);
    const diagnostics = Array.from({ length: errorCount }, (_, i) =>
      makeTsFileDiagnostic(ts.DiagnosticCategory.Error, 2322, `error ${i}`, FILE, CONTENT, i),
    );
    const service = makeTsFileService(diagnostics);
    const result = await vueGetTypeErrorsForTsFile(FILE, async () => service);
    expect(result.truncated).toBe(truncated);
    expect(result.diagnostics).toHaveLength(Math.min(errorCount, MAX_DIAGNOSTICS));
    expect(result.errorCount).toBe(errorCount);
  });

  it("requests the service for the given file", async () => {
    const service = makeTsFileService([]);
    const getService = vi.fn().mockResolvedValue(service);
    await vueGetTypeErrorsForTsFile("/project/main.ts", getService);
    expect(getService).toHaveBeenCalledWith("/project/main.ts");
  });
});

describe("vueGetTypeErrorsForProject", () => {
  /**
   * A service whose scriptFileNames lists both plain .ts entries and one .vue
   * virtual entry, with baseService.getSemanticDiagnostics keyed by the
   * requested fileName — the shape vueGetTypeErrorsForProject now iterates
   * directly (no separate tsEngine involved).
   */
  function makeProjectService(
    tsDiagnosticsByFile: Record<string, ts.Diagnostic[]>,
    vue: {
      virtualPath: string;
      realVuePath: string;
      diagnostics: ts.Diagnostic[];
      offsets: Array<[number, number]>;
      realContent?: string;
    },
  ): CachedService {
    const base = makeServiceWithSourceMap(
      vue.virtualPath,
      vue.realVuePath,
      vue.diagnostics,
      vue.offsets,
      vue.realContent,
    );
    return {
      ...base,
      baseService: {
        getSemanticDiagnostics: (fileName: string) =>
          fileName === vue.virtualPath ? vue.diagnostics : (tsDiagnosticsByFile[fileName] ?? []),
        // Every mocked file is in the program; the exclusion path is covered by the
        // vite.config.js case in getTypeErrors.test.ts against a real service.
        getProgram: () => ({ getSourceFile: () => ({}) }),
      } as unknown as ts.LanguageService,
      scriptFileNames: [...Object.keys(tsDiagnosticsByFile), vue.virtualPath],
      // No tsconfig: the checked set is the whole scriptFileNames walk, which must
      // agree with the override above rather than the seed makeServiceWithSourceMap set.
      seedFileNames: null,
    };
  }

  it.each([
    { tsCount: 60, vueCount: 41, truncated: true, total: 101 },
    { tsCount: 60, vueCount: 40, truncated: false, total: 100 },
  ])(
    "truncated=$truncated when $tsCount TS + $vueCount Vue = $total",
    async ({ tsCount, vueCount, truncated, total }) => {
      const REAL_VUE = "/project/Test.vue";
      const VIRTUAL_PATH = `${REAL_VUE}.ts`;
      const vueDiagnostics = Array.from({ length: vueCount }, (_, i) =>
        makeDiagnostic(ts.DiagnosticCategory.Error, 2322, `vue error ${i}`, i),
      );
      const tsFileContent = "const x: number = 'not-a-number';\n";
      const tsDiagnosticsByFile = Object.fromEntries(
        Array.from({ length: tsCount }, (_, i) => [
          `/project/file${i}.ts`,
          [
            makeTsFileDiagnostic(
              ts.DiagnosticCategory.Error,
              2322,
              `ts error ${i}`,
              `/project/file${i}.ts`,
              tsFileContent,
              0,
            ),
          ],
        ]),
      );
      const service = makeProjectService(tsDiagnosticsByFile, {
        virtualPath: VIRTUAL_PATH,
        realVuePath: REAL_VUE,
        diagnostics: vueDiagnostics,
        offsets: vueDiagnostics.map((_, i) => [i, 0] as [number, number]),
        realContent: "x".repeat(vueCount + 1),
      });

      const result = await vueGetTypeErrorsForProject(async () => service, null, "/project");

      expect(result.truncated).toBe(truncated);
      expect(result.diagnostics).toHaveLength(Math.min(total, MAX_DIAGNOSTICS));
      expect(result.errorCount).toBe(total);
    },
  );

  it("attributes ts and vue diagnostics to their own files without double-counting the vue virtual entry", async () => {
    const REAL_VUE = "/project/Test.vue";
    const VIRTUAL_PATH = `${REAL_VUE}.ts`;
    const tsFileContent = "const x: number = 'not-a-number';\n";
    const service = makeProjectService(
      {
        "/project/broken.ts": [
          makeTsFileDiagnostic(
            ts.DiagnosticCategory.Error,
            2322,
            "ts error",
            "/project/broken.ts",
            tsFileContent,
            0,
          ),
        ],
      },
      {
        virtualPath: VIRTUAL_PATH,
        realVuePath: REAL_VUE,
        diagnostics: [makeDiagnostic(ts.DiagnosticCategory.Error, 2322, "vue error", 0)],
        offsets: [[0, 0]],
      },
    );

    const result = await vueGetTypeErrorsForProject(async () => service, null, "/project");

    expect(result.errorCount).toBe(2);
    expect(result.diagnostics).toHaveLength(2);
    const files = result.diagnostics.map((d) => d.file).sort();
    expect(files).toEqual(["/project/Test.vue", "/project/broken.ts"]);
  });

  it("requests a project-wide service without fabricating a file path", async () => {
    const service = makeMinimalService("/project/Unused.vue.ts", "/project/Unused.vue", []);
    const getService = vi.fn().mockResolvedValue({ ...service, scriptFileNames: [] });

    await vueGetTypeErrorsForProject(getService, null, "/project");

    expect(getService).toHaveBeenCalledWith(undefined);
  });
});
