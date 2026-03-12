import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { moveSymbol } from "../../src/operations/moveSymbol.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";
import { makeMockCompiler } from "../compilers/__helpers__/mock-compiler.js";

function makeMockTsCompiler(overrides: Record<string, unknown> = {}) {
  return {
    moveSymbol: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Create a temporary directory with a real source file so assertFileExists passes.
 * Returns the dir, source path, dest path, and a scope rooted at the dir.
 */
function makeRealScope() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-movesymbol-unit-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const source = path.join(dir, "src/utils.ts");
  const dest = path.join(dir, "src/helpers.ts");
  fs.writeFileSync(source, "export function greetUser(name: string): string { return name; }\n");
  const scope = new WorkspaceScope(dir, new NodeFileSystem());
  return { dir, source, dest, scope };
}

const SYMBOL = "greetUser";

describe("moveSymbol operation (thin orchestrator)", () => {
  const dirs: string[] = [];
  let dir: string;
  let source: string;
  let dest: string;
  let scope: WorkspaceScope;

  beforeEach(() => {
    ({ dir, source, dest, scope } = makeRealScope());
    dirs.push(dir);
  });

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  describe("orchestrator delegates to tsCompiler", () => {
    it("calls tsCompiler.moveSymbol with resolved absolute paths, symbol, scope, and options", async () => {
      const tsCompiler = makeMockTsCompiler();
      const projectCompiler = makeMockCompiler();

      await moveSymbol(tsCompiler as never, projectCompiler, source, SYMBOL, dest, scope);

      expect(tsCompiler.moveSymbol).toHaveBeenCalledWith(
        path.resolve(source),
        SYMBOL,
        path.resolve(dest),
        scope,
        undefined,
      );
    });

    it("forwards options to tsCompiler.moveSymbol", async () => {
      const tsCompiler = makeMockTsCompiler();
      const projectCompiler = makeMockCompiler();
      const opts = { force: true };

      await moveSymbol(tsCompiler as never, projectCompiler, source, SYMBOL, dest, scope, opts);

      expect(tsCompiler.moveSymbol).toHaveBeenCalledWith(
        path.resolve(source),
        SYMBOL,
        path.resolve(dest),
        scope,
        opts,
      );
    });
  });

  describe("after-hook invocation", () => {
    it("calls afterSymbolMove with absSource, symbol, absDest, and scope", async () => {
      const tsCompiler = makeMockTsCompiler();
      const projectCompiler = makeMockCompiler();

      await moveSymbol(tsCompiler as never, projectCompiler, source, SYMBOL, dest, scope);

      expect(projectCompiler.afterSymbolMove).toHaveBeenCalledWith(
        path.resolve(source),
        SYMBOL,
        path.resolve(dest),
        scope,
      );
    });

    it("files recorded into scope by afterSymbolMove appear in the result", async () => {
      const extraFile = path.join(dir, "src/extra.ts");
      const tsCompiler = makeMockTsCompiler();
      const projectCompiler = makeMockCompiler({
        afterSymbolMove: vi
          .fn()
          .mockImplementation((_src: string, _sym: string, _dst: string, s: WorkspaceScope) => {
            s.recordModified(extraFile);
          }),
      });

      const result = await moveSymbol(
        tsCompiler as never,
        projectCompiler,
        source,
        SYMBOL,
        dest,
        scope,
      );

      expect(result.filesModified).toContain(extraFile);
    });

    it("skipped files recorded into scope by afterSymbolMove appear in the result", async () => {
      const skippedFile = "/outside/workspace/file.vue";
      const tsCompiler = makeMockTsCompiler();
      const projectCompiler = makeMockCompiler({
        afterSymbolMove: vi
          .fn()
          .mockImplementation((_src: string, _sym: string, _dst: string, s: WorkspaceScope) => {
            s.recordSkipped(skippedFile);
          }),
      });

      const result = await moveSymbol(
        tsCompiler as never,
        projectCompiler,
        source,
        SYMBOL,
        dest,
        scope,
      );

      expect(result.filesSkipped).toContain(skippedFile);
    });
  });

  describe("return shape", () => {
    it("returns correct filesModified, filesSkipped, symbolName, sourceFile, and destFile", async () => {
      const capturedSource = source;
      const capturedDest = dest;
      const tsCompiler = makeMockTsCompiler({
        moveSymbol: vi
          .fn()
          .mockImplementation((_src: string, _sym: string, _dst: string, s: WorkspaceScope) => {
            s.recordModified(capturedSource);
            s.recordModified(capturedDest);
          }),
      });
      const projectCompiler = makeMockCompiler();

      const result = await moveSymbol(
        tsCompiler as never,
        projectCompiler,
        source,
        SYMBOL,
        dest,
        scope,
      );

      expect(result.symbolName).toBe(SYMBOL);
      expect(result.sourceFile).toBe(path.resolve(source));
      expect(result.destFile).toBe(path.resolve(dest));
      expect(result.filesModified).toContain(source);
      expect(result.filesModified).toContain(dest);
      expect(result.filesSkipped).toEqual([]);
    });
  });

  describe("assertFileExists", () => {
    it("throws FILE_NOT_FOUND when the source file does not exist", async () => {
      const tsCompiler = makeMockTsCompiler();
      const projectCompiler = makeMockCompiler();
      const missingSource = path.join(dir, "src/doesNotExist.ts");

      await expect(
        moveSymbol(tsCompiler as never, projectCompiler, missingSource, SYMBOL, dest, scope),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });
  });
});
