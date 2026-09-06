import type ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../ports/filesystem.js";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { type DiagnosticService, DiagnosticServiceCache } from "./diagnostic-service.js";

const OPTIONS = { noLib: true };

function fsWith(files: Record<string, string>): InMemoryFileSystem {
  const fs = new InMemoryFileSystem();
  for (const [path, content] of Object.entries(files)) {
    fs.writeFile(path, content);
  }
  return fs;
}

/** Builds a service the way production does — through the cache, which owns construction. */
function serviceFor(
  compilerOptions: ts.CompilerOptions,
  rootNames: string[],
  tsConfigPath: string | null,
  fs: FileSystem,
): DiagnosticService {
  return new DiagnosticServiceCache().get(tsConfigPath, () => ({
    compilerOptions,
    rootNames,
    fs,
  }));
}

describe("the diagnostic service", () => {
  it("computes semantic diagnostics from file content read through the given FileSystem", () => {
    const fs = fsWith({ "/proj/a.ts": "const x: number = 'oops';" });

    const service = serviceFor(OPTIONS, ["/proj/a.ts"], null, fs);

    expect(service.getSemanticDiagnostics("/proj/a.ts").map((d) => d.code)).toContain(2322);
  });

  it("reports no diagnostics for content that type-checks cleanly", () => {
    const fs = fsWith({ "/proj/a.ts": "const x: number = 1;" });

    const service = serviceFor(OPTIONS, ["/proj/a.ts"], null, fs);

    expect(service.getSemanticDiagnostics("/proj/a.ts")).toEqual([]);
  });

  it("copies the given file list rather than sharing the caller's array", () => {
    const fs = fsWith({ "/proj/a.ts": "const x: number = 1;", "/proj/b.ts": "const y = 1;" });
    const given = ["/proj/a.ts"];

    const service = serviceFor(OPTIONS, given, null, fs);
    given.push("/proj/b.ts");

    expect(service.getProgram().getSourceFile("/proj/b.ts")).toBeUndefined();
  });

  it("type-checks a file nested below the tsconfig", () => {
    const fs = fsWith({ "/proj/nested/a.ts": "const x: number = 1;" });

    const service = serviceFor(OPTIONS, ["/proj/nested/a.ts"], "/proj/nested/tsconfig.json", fs);

    expect(service.getSemanticDiagnostics("/proj/nested/a.ts")).toEqual([]);
  });

  it("throws naming the file when asked about one the program does not contain", () => {
    const fs = fsWith({ "/proj/a.ts": "const x: number = 1;" });

    const service = serviceFor(OPTIONS, ["/proj/a.ts"], null, fs);

    expect(() => service.getSemanticDiagnostics("/proj/absent.ts")).toThrow("/proj/absent.ts");
  });

  it("treats a file the FileSystem cannot read as absent rather than propagating the error", () => {
    const fs = fsWith({ "/proj/a.ts": "const x: number = 1;" });
    fs.readFile = () => {
      throw new Error("EACCES");
    };

    const service = serviceFor(OPTIONS, ["/proj/a.ts"], null, fs);

    expect(service.getProgram().getSourceFile("/proj/a.ts")).toBeUndefined();
  });

  it("resolves a relative import through the FileSystem's directory probes", () => {
    const fs = fsWith({
      "/proj/a.ts": 'import { y } from "./b.js";\nconst x: number = y;',
      "/proj/b.ts": "export const y = 'not a number';",
    });

    const service = serviceFor(
      { noLib: true, module: 99, moduleResolution: 99 },
      ["/proj/a.ts", "/proj/b.ts"],
      "/proj/tsconfig.json",
      fs,
    );

    expect(service.getSemanticDiagnostics("/proj/a.ts").map((d) => d.code)).toContain(2322);
  });

  it("reuses the parse of a file already read when another root is added", () => {
    const fs = fsWith({ "/proj/a.ts": "const x = 1;", "/proj/b.ts": "const y = 2;" });
    const service = serviceFor(OPTIONS, ["/proj/a.ts"], null, fs);
    const firstParse = service.getProgram().getSourceFile("/proj/a.ts");

    service.addScriptFile("/proj/b.ts");

    expect(service.getProgram().getSourceFile("/proj/a.ts")).toBe(firstParse);
  });

  it("matches file names case-sensitively", () => {
    const fs = fsWith({ "/proj/a.ts": "const x: number = 1;" });

    const service = serviceFor(OPTIONS, ["/proj/a.ts"], null, fs);

    expect(service.getProgram().getSourceFile("/proj/A.ts")).toBeUndefined();
  });

  describe("addScriptFile", () => {
    it("brings a file the tsconfig does not cover into the program", () => {
      const fs = fsWith({
        "/proj/a.ts": "const x: number = 1;",
        "/proj/b.ts": "const y: number = 'oops';",
      });
      const service = serviceFor(OPTIONS, ["/proj/a.ts"], null, fs);

      service.addScriptFile("/proj/b.ts");

      expect(service.getSemanticDiagnostics("/proj/b.ts").map((d) => d.code)).toContain(2322);
    });

    it("adds the file to a program that was already built", () => {
      const fs = fsWith({
        "/proj/a.ts": "const x: number = 1;",
        "/proj/b.ts": "const y: number = 'oops';",
      });
      const service = serviceFor(OPTIONS, ["/proj/a.ts"], null, fs);
      service.getProgram();

      service.addScriptFile("/proj/b.ts");

      expect(service.getSemanticDiagnostics("/proj/b.ts").map((d) => d.code)).toContain(2322);
    });

    it("does not rebuild when the same added file is offered twice", () => {
      const fs = fsWith({ "/proj/a.ts": "const x = 1;", "/proj/b.ts": "const y = 2;" });
      const service = serviceFor(OPTIONS, ["/proj/a.ts"], null, fs);
      service.addScriptFile("/proj/b.ts");
      const afterFirstAdd = service.getProgram();

      service.addScriptFile("/proj/b.ts");

      expect(service.getProgram()).toBe(afterFirstAdd);
    });

    it("does not rebuild the program when the file is already a root", () => {
      const fs = fsWith({ "/proj/a.ts": "const x: number = 1;" });
      const service = serviceFor(OPTIONS, ["/proj/a.ts"], null, fs);
      const before = service.getProgram();

      service.addScriptFile("/proj/a.ts");

      expect(service.getProgram()).toBe(before);
    });
  });
});

describe("DiagnosticServiceCache", () => {
  // An empty root set keeps `get`'s real service construction cheap; these cases
  // are about which entry comes back, not what it reports.
  const emptyProject = () => ({ compilerOptions: OPTIONS, rootNames: [], fs: fsWith({}) });

  it("returns the same entry for the same tsconfig path without rebuilding", () => {
    const cache = new DiagnosticServiceCache();
    let loadCount = 0;
    const load = () => {
      loadCount += 1;
      return emptyProject();
    };

    const first = cache.get("/proj/tsconfig.json", load);
    const second = cache.get("/proj/tsconfig.json", load);

    expect(second).toBe(first);
    expect(loadCount).toBe(1);
  });

  it("keeps separate entries for different tsconfig paths, including no-tsconfig", () => {
    const cache = new DiagnosticServiceCache();

    const forConfig = cache.get("/proj/tsconfig.json", emptyProject);
    const forOtherConfig = cache.get("/other/tsconfig.json", emptyProject);
    const forNoConfig = cache.get(null, emptyProject);

    expect(forConfig).not.toBe(forOtherConfig);
    expect(forConfig).not.toBe(forNoConfig);
    expect(cache.get(null, emptyProject)).toBe(forNoConfig);
  });

  it("rebuilds on the next get after invalidate", () => {
    const cache = new DiagnosticServiceCache();
    const first = cache.get("/proj/tsconfig.json", emptyProject);

    cache.invalidate("/proj/tsconfig.json");

    expect(cache.get("/proj/tsconfig.json", emptyProject)).not.toBe(first);
  });

  it("invalidating an unbuilt tsconfig path is a no-op", () => {
    const cache = new DiagnosticServiceCache();
    expect(() => cache.invalidate("/never/built/tsconfig.json")).not.toThrow();
  });

  it("refreshing an unbuilt tsconfig path is a no-op", () => {
    const cache = new DiagnosticServiceCache();
    expect(() => cache.refreshFile("/never/built/tsconfig.json", "/a.ts")).not.toThrow();
  });

  it("invalidating one tsconfig path leaves other cached entries untouched", () => {
    const cache = new DiagnosticServiceCache();
    const untouched = cache.get("/other/tsconfig.json", emptyProject);
    cache.get("/proj/tsconfig.json", emptyProject);

    cache.invalidate("/proj/tsconfig.json");

    expect(cache.get("/other/tsconfig.json", emptyProject)).toBe(untouched);
  });

  describe("retained parse cache", () => {
    const TSCONFIG = "/proj/tsconfig.json";
    const ROOTS = ["/proj/a.ts", "/proj/b.ts", "/proj/c.ts"];

    function arrange() {
      const fs = fsWith({
        "/proj/a.ts": "const x: number = 1;",
        "/proj/b.ts": "const y = 2;",
        "/proj/c.ts": "const z = 3;",
      });
      const cache = new DiagnosticServiceCache();
      const load = () => ({ compilerOptions: OPTIONS, rootNames: ROOTS, fs });
      return { fs, cache, load };
    }

    it("reports a newly introduced type error after refreshFile evicts the changed file", () => {
      const { fs, cache, load } = arrange();

      expect(cache.get(TSCONFIG, load).getSemanticDiagnostics("/proj/a.ts")).toEqual([]);

      fs.writeFile("/proj/a.ts", "const x: number = 'oops';");
      cache.refreshFile(TSCONFIG, "/proj/a.ts");

      expect(
        cache
          .get(TSCONFIG, load)
          .getSemanticDiagnostics("/proj/a.ts")
          .map((d) => d.code),
      ).toContain(2322);
    });

    it("keeps the built service when the evicted path was never parsed", () => {
      const { cache, load } = arrange();

      const first = cache.get(TSCONFIG, load);
      first.getProgram();

      cache.refreshFile(TSCONFIG, "/proj/not-a-source-file.md");

      expect(cache.get(TSCONFIG, load)).toBe(first);
    });

    it.each([
      {
        signal: "refreshFile",
        evict: (cache: DiagnosticServiceCache) => cache.refreshFile(TSCONFIG, "/proj/a.ts"),
        expected: ["/proj/a.ts"],
      },
      {
        signal: "invalidate",
        evict: (cache: DiagnosticServiceCache) => cache.invalidate(TSCONFIG),
        expected: ROOTS,
      },
    ])("re-parses only what $signal evicted", ({ evict, expected }) => {
      const { fs, cache, load } = arrange();
      const readSpy = vi.spyOn(fs, "readFile");

      cache.get(TSCONFIG, load).getProgram();
      readSpy.mockClear();

      evict(cache);
      cache.get(TSCONFIG, load).getProgram();

      expect(readSpy.mock.calls.map(([path]) => path).sort()).toEqual([...expected].sort());
    });
  });
});
