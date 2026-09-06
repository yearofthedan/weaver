import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import {
  buildDiagnosticService,
  type DiagnosticService,
  DiagnosticServiceCache,
} from "./diagnostic-service.js";

const OPTIONS = { noLib: true };

function fsWith(files: Record<string, string>): InMemoryFileSystem {
  const fs = new InMemoryFileSystem();
  for (const [path, content] of Object.entries(files)) {
    fs.writeFile(path, content);
  }
  return fs;
}

describe("buildDiagnosticService", () => {
  it("computes semantic diagnostics from file content read through the given FileSystem", () => {
    const fs = fsWith({ "/proj/a.ts": "const x: number = 'oops';" });

    const service = buildDiagnosticService(OPTIONS, ["/proj/a.ts"], null, fs);

    expect(service.getSemanticDiagnostics("/proj/a.ts").map((d) => d.code)).toContain(2322);
  });

  it("reports no diagnostics for content that type-checks cleanly", () => {
    const fs = fsWith({ "/proj/a.ts": "const x: number = 1;" });

    const service = buildDiagnosticService(OPTIONS, ["/proj/a.ts"], null, fs);

    expect(service.getSemanticDiagnostics("/proj/a.ts")).toEqual([]);
  });

  it("copies the given file list rather than sharing the caller's array", () => {
    const fs = fsWith({ "/proj/a.ts": "const x: number = 1;", "/proj/b.ts": "const y = 1;" });
    const given = ["/proj/a.ts"];

    const service = buildDiagnosticService(OPTIONS, given, null, fs);
    given.push("/proj/b.ts");

    expect(service.getProgram().getSourceFile("/proj/b.ts")).toBeUndefined();
  });

  it("resolves the current directory from the tsconfig's own directory, not cwd", () => {
    const fs = fsWith({ "/proj/nested/a.ts": "const x: number = 1;" });

    const service = buildDiagnosticService(
      OPTIONS,
      ["/proj/nested/a.ts"],
      "/proj/nested/tsconfig.json",
      fs,
    );

    expect(service.getSemanticDiagnostics("/proj/nested/a.ts")).toEqual([]);
  });

  it("throws naming the file when asked about one the program does not contain", () => {
    const fs = fsWith({ "/proj/a.ts": "const x: number = 1;" });

    const service = buildDiagnosticService(OPTIONS, ["/proj/a.ts"], null, fs);

    expect(() => service.getSemanticDiagnostics("/proj/absent.ts")).toThrow("/proj/absent.ts");
  });

  it("treats a file the FileSystem cannot read as absent rather than propagating the error", () => {
    const fs = fsWith({ "/proj/a.ts": "const x: number = 1;" });
    fs.readFile = () => {
      throw new Error("EACCES");
    };

    const service = buildDiagnosticService(OPTIONS, ["/proj/a.ts"], null, fs);

    expect(service.getProgram().getSourceFile("/proj/a.ts")).toBeUndefined();
  });

  it("still type-checks when the FileSystem throws on every directory probe", () => {
    const fs = fsWith({ "/proj/a.ts": "const x: number = 'oops';" });
    const boom = () => {
      throw new Error("EIO");
    };
    fs.exists = boom;
    fs.stat = boom;
    fs.readdir = boom;
    fs.realpath = boom;

    const service = buildDiagnosticService(OPTIONS, ["/proj/a.ts"], null, fs);

    expect(service.getSemanticDiagnostics("/proj/a.ts").map((d) => d.code)).toContain(2322);
  });

  it("resolves a relative import through the FileSystem's directory probes", () => {
    const fs = fsWith({
      "/proj/a.ts": 'import { y } from "./b.js";\nconst x: number = y;',
      "/proj/b.ts": "export const y = 'not a number';",
    });

    const service = buildDiagnosticService(
      { noLib: true, module: 99, moduleResolution: 99 },
      ["/proj/a.ts", "/proj/b.ts"],
      "/proj/tsconfig.json",
      fs,
    );

    expect(service.getSemanticDiagnostics("/proj/a.ts").map((d) => d.code)).toContain(2322);
  });

  it("reuses the parse of a file already read when another root is added", () => {
    const fs = fsWith({ "/proj/a.ts": "const x = 1;", "/proj/b.ts": "const y = 2;" });
    const service = buildDiagnosticService(OPTIONS, ["/proj/a.ts"], null, fs);
    const firstParse = service.getProgram().getSourceFile("/proj/a.ts");

    service.addScriptFile("/proj/b.ts");

    expect(service.getProgram().getSourceFile("/proj/a.ts")).toBe(firstParse);
  });

  it("matches file names case-sensitively", () => {
    const fs = fsWith({ "/proj/a.ts": "const x: number = 1;" });

    const service = buildDiagnosticService(OPTIONS, ["/proj/a.ts"], null, fs);

    expect(service.getProgram().getSourceFile("/proj/A.ts")).toBeUndefined();
  });

  describe("addScriptFile", () => {
    it("brings a file the tsconfig does not cover into the program", () => {
      const fs = fsWith({
        "/proj/a.ts": "const x: number = 1;",
        "/proj/b.ts": "const y: number = 'oops';",
      });
      const service = buildDiagnosticService(OPTIONS, ["/proj/a.ts"], null, fs);

      service.addScriptFile("/proj/b.ts");

      expect(service.getSemanticDiagnostics("/proj/b.ts").map((d) => d.code)).toContain(2322);
    });

    it("adds the file to a program that was already built", () => {
      const fs = fsWith({
        "/proj/a.ts": "const x: number = 1;",
        "/proj/b.ts": "const y: number = 'oops';",
      });
      const service = buildDiagnosticService(OPTIONS, ["/proj/a.ts"], null, fs);
      service.getProgram();

      service.addScriptFile("/proj/b.ts");

      expect(service.getSemanticDiagnostics("/proj/b.ts").map((d) => d.code)).toContain(2322);
    });

    it("does not rebuild when the same added file is offered twice", () => {
      const fs = fsWith({ "/proj/a.ts": "const x = 1;", "/proj/b.ts": "const y = 2;" });
      const service = buildDiagnosticService(OPTIONS, ["/proj/a.ts"], null, fs);
      service.addScriptFile("/proj/b.ts");
      const afterFirstAdd = service.getProgram();

      service.addScriptFile("/proj/b.ts");

      expect(service.getProgram()).toBe(afterFirstAdd);
    });

    it("does not rebuild the program when the file is already a root", () => {
      const fs = fsWith({ "/proj/a.ts": "const x: number = 1;" });
      const service = buildDiagnosticService(OPTIONS, ["/proj/a.ts"], null, fs);
      const before = service.getProgram();

      service.addScriptFile("/proj/a.ts");

      expect(service.getProgram()).toBe(before);
    });
  });
});

describe("DiagnosticServiceCache", () => {
  function fakeService(overrides: Partial<DiagnosticService> = {}): DiagnosticService {
    return {
      getSemanticDiagnostics: () => [],
      getProgram: () => {
        throw new Error("not implemented in this fake");
      },
      addScriptFile: () => {},
      ...overrides,
    };
  }

  it("returns the same entry for the same tsconfig path without rebuilding", () => {
    const cache = new DiagnosticServiceCache();
    let buildCount = 0;
    const build = () => {
      buildCount += 1;
      return fakeService();
    };

    const first = cache.get("/proj/tsconfig.json", build);
    const second = cache.get("/proj/tsconfig.json", build);

    expect(second).toBe(first);
    expect(buildCount).toBe(1);
  });

  it("keeps separate entries for different tsconfig paths, including no-tsconfig", () => {
    const cache = new DiagnosticServiceCache();

    const forConfig = cache.get("/proj/tsconfig.json", () => fakeService());
    const forOtherConfig = cache.get("/other/tsconfig.json", () => fakeService());
    const forNoConfig = cache.get(null, () => fakeService());

    expect(forConfig).not.toBe(forOtherConfig);
    expect(forConfig).not.toBe(forNoConfig);
    expect(cache.get(null, () => fakeService())).toBe(forNoConfig);
  });

  it("rebuilds on the next get after invalidate", () => {
    const cache = new DiagnosticServiceCache();
    const first = cache.get("/proj/tsconfig.json", () => fakeService());

    cache.invalidate("/proj/tsconfig.json");

    expect(cache.get("/proj/tsconfig.json", () => fakeService())).not.toBe(first);
  });

  it("invalidating an unbuilt tsconfig path is a no-op", () => {
    const cache = new DiagnosticServiceCache();
    expect(() => cache.invalidate("/never/built/tsconfig.json")).not.toThrow();
  });

  it("invalidating one tsconfig path leaves other cached entries untouched", () => {
    const cache = new DiagnosticServiceCache();
    const untouched = cache.get("/other/tsconfig.json", () => fakeService());
    cache.get("/proj/tsconfig.json", () => fakeService());

    cache.invalidate("/proj/tsconfig.json");

    expect(cache.get("/other/tsconfig.json", () => fakeService())).toBe(untouched);
  });
});
