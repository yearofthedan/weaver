import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockCompiler } from "../compilers/__helpers__/mock-compiler.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { moveSymbol } from "./moveSymbol.js";

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

  describe("orchestrator delegates to engine", () => {
    it("calls engine.moveSymbol with resolved absolute paths, symbol, scope, and options", async () => {
      const engine = makeMockCompiler();

      await moveSymbol(engine, source, SYMBOL, dest, scope);

      expect(engine.moveSymbol).toHaveBeenCalledWith(
        path.resolve(source),
        SYMBOL,
        path.resolve(dest),
        scope,
        undefined,
      );
    });

    it("forwards options to engine.moveSymbol", async () => {
      const engine = makeMockCompiler();
      const opts = { force: true };

      await moveSymbol(engine, source, SYMBOL, dest, scope, opts);

      expect(engine.moveSymbol).toHaveBeenCalledWith(
        path.resolve(source),
        SYMBOL,
        path.resolve(dest),
        scope,
        opts,
      );
    });
  });

  describe("scope modifications flow to result", () => {
    it("files recorded into scope by engine.moveSymbol appear in filesModified", async () => {
      const extraFile = path.join(dir, "src/extra.ts");
      const engine = makeMockCompiler({
        moveSymbol: vi
          .fn()
          .mockImplementation((_src: string, _sym: string, _dst: string, s: WorkspaceScope) => {
            s.recordModified(extraFile);
          }),
      });

      const result = await moveSymbol(engine, source, SYMBOL, dest, scope);

      expect(result.filesModified).toContain(extraFile);
    });

    it("skipped files recorded into scope by engine.moveSymbol appear in filesSkipped", async () => {
      const skippedFile = "/outside/workspace/file.vue";
      const engine = makeMockCompiler({
        moveSymbol: vi
          .fn()
          .mockImplementation((_src: string, _sym: string, _dst: string, s: WorkspaceScope) => {
            s.recordSkipped(skippedFile);
          }),
      });

      const result = await moveSymbol(engine, source, SYMBOL, dest, scope);

      expect(result.filesSkipped).toContain(skippedFile);
    });
  });

  describe("return shape", () => {
    it("returns correct filesModified, filesSkipped, symbolName, sourceFile, and destFile", async () => {
      const capturedSource = source;
      const capturedDest = dest;
      const engine = makeMockCompiler({
        moveSymbol: vi
          .fn()
          .mockImplementation((_src: string, _sym: string, _dst: string, s: WorkspaceScope) => {
            s.recordModified(capturedSource);
            s.recordModified(capturedDest);
          }),
      });

      const result = await moveSymbol(engine, source, SYMBOL, dest, scope);

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
      const engine = makeMockCompiler();
      const missingSource = path.join(dir, "src/doesNotExist.ts");

      await expect(moveSymbol(engine, missingSource, SYMBOL, dest, scope)).rejects.toMatchObject({
        code: "FILE_NOT_FOUND",
      });
    });
  });
});
