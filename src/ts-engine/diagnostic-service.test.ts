import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import {
  buildDiagnosticService,
  type DiagnosticService,
  DiagnosticServiceCache,
} from "./diagnostic-service.js";

describe("buildDiagnosticService", () => {
  it("computes semantic diagnostics from file content read through the given FileSystem", () => {
    const fs = new InMemoryFileSystem();
    fs.writeFile("/proj/a.ts", "const x: number = 'oops';");

    const service = buildDiagnosticService({ noLib: true }, ["/proj/a.ts"], null, fs);

    const diags = service.languageService.getSemanticDiagnostics("/proj/a.ts");
    expect(diags.some((d) => d.code === 2322)).toBe(true);
  });

  it("reports no diagnostics for content that type-checks cleanly", () => {
    const fs = new InMemoryFileSystem();
    fs.writeFile("/proj/a.ts", "const x: number = 1;");

    const service = buildDiagnosticService({ noLib: true }, ["/proj/a.ts"], null, fs);

    expect(service.languageService.getSemanticDiagnostics("/proj/a.ts")).toEqual([]);
  });

  it("copies the given file list rather than sharing the caller's array", () => {
    const fs = new InMemoryFileSystem();
    fs.writeFile("/proj/a.ts", "const x: number = 1;");
    const given = ["/proj/a.ts"];

    const service = buildDiagnosticService({ noLib: true }, given, null, fs);
    given.push("/proj/b.ts");

    expect(service.scriptFileNames).toEqual(["/proj/a.ts"]);
  });

  it("picks up a file pushed onto scriptFileNames after construction", () => {
    const fs = new InMemoryFileSystem();
    fs.writeFile("/proj/a.ts", "const x: number = 1;");
    fs.writeFile("/proj/b.ts", "const y: number = 'oops';");

    const service = buildDiagnosticService({ noLib: true }, ["/proj/a.ts"], null, fs);
    service.scriptFileNames.push("/proj/b.ts");

    const diags = service.languageService.getSemanticDiagnostics("/proj/b.ts");
    expect(diags.some((d) => d.code === 2322)).toBe(true);
  });

  it("resolves the current directory from the tsconfig's own directory, not cwd", () => {
    const fs = new InMemoryFileSystem();
    fs.writeFile("/proj/nested/a.ts", "const x: number = 1;");

    const service = buildDiagnosticService(
      { noLib: true },
      ["/proj/nested/a.ts"],
      "/proj/nested/tsconfig.json",
      fs,
    );

    expect(service.languageService.getSemanticDiagnostics("/proj/nested/a.ts")).toEqual([]);
  });
});

describe("DiagnosticServiceCache", () => {
  function fakeService(): DiagnosticService {
    return {
      languageService: {
        getSemanticDiagnostics: () => [],
        getProgram: () => {
          throw new Error("not implemented in this fake");
        },
      },
      scriptFileNames: [],
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

    const forConfig = cache.get("/proj/tsconfig.json", fakeService);
    const forOtherConfig = cache.get("/other/tsconfig.json", fakeService);
    const forNoConfig = cache.get(null, fakeService);

    expect(forConfig).not.toBe(forOtherConfig);
    expect(forConfig).not.toBe(forNoConfig);
    expect(cache.get(null, fakeService)).toBe(forNoConfig);
  });

  it("rebuilds on the next get after invalidate", () => {
    const cache = new DiagnosticServiceCache();
    const first = cache.get("/proj/tsconfig.json", fakeService);

    cache.invalidate("/proj/tsconfig.json");
    const second = cache.get("/proj/tsconfig.json", fakeService);

    expect(second).not.toBe(first);
  });

  it("invalidating an unbuilt tsconfig path is a no-op", () => {
    const cache = new DiagnosticServiceCache();
    expect(() => cache.invalidate("/never/built/tsconfig.json")).not.toThrow();
  });

  it("invalidating one tsconfig path leaves other cached entries untouched", () => {
    const cache = new DiagnosticServiceCache();
    const untouched = cache.get("/other/tsconfig.json", fakeService);
    cache.get("/proj/tsconfig.json", fakeService);

    cache.invalidate("/proj/tsconfig.json");

    expect(cache.get("/other/tsconfig.json", fakeService)).toBe(untouched);
  });
});
