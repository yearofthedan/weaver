import * as path from "node:path";
import { describe, expect, vi } from "vitest";
import { fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { makeMockCompiler } from "../ts-engine/__testHelpers__/mock-compiler.js";
import { moveSymbol } from "./moveSymbol.js";

const SYMBOL = "greetUser";

async function setup(
  dir: string,
  seedInlineFixture: (files: Record<string, string>) => Promise<void>,
) {
  await seedInlineFixture({
    "src/utils.ts": "export function greetUser(name: string): string { return name; }\n",
  });
  return {
    source: path.join(dir, "src/utils.ts"),
    dest: path.join(dir, "src/helpers.ts"),
    scope: new WorkspaceScope(dir, new NodeFileSystem()),
  };
}

describe("moveSymbol operation (thin orchestrator)", () => {
  describe("orchestrator delegates to engine", () => {
    test("calls engine.moveSymbol with resolved absolute paths, symbol, scope, and options", async ({
      dir,
      seedInlineFixture,
    }) => {
      const { source, dest, scope } = await setup(dir, seedInlineFixture);
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

    test("forwards options to engine.moveSymbol", async ({ dir, seedInlineFixture }) => {
      const { source, dest, scope } = await setup(dir, seedInlineFixture);
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
    test("files recorded into scope by engine.moveSymbol appear in filesModified", async ({
      dir,
      seedInlineFixture,
    }) => {
      const { source, dest, scope } = await setup(dir, seedInlineFixture);
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

    test("skipped files recorded into scope by engine.moveSymbol appear in filesSkipped", async ({
      dir,
      seedInlineFixture,
    }) => {
      const { source, dest, scope } = await setup(dir, seedInlineFixture);
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
    test("returns correct filesModified, filesSkipped, symbolName, sourceFile, and destFile", async ({
      dir,
      seedInlineFixture,
    }) => {
      const { source, dest, scope } = await setup(dir, seedInlineFixture);
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
    test("throws FILE_NOT_FOUND when the source file does not exist", async ({
      dir,
      seedInlineFixture,
    }) => {
      const { dest, scope } = await setup(dir, seedInlineFixture);
      const engine = makeMockCompiler();
      const missingSource = path.join(dir, "src/doesNotExist.ts");

      await expect(moveSymbol(engine, missingSource, SYMBOL, dest, scope)).rejects.toMatchObject({
        code: "FILE_NOT_FOUND",
      });
    });
  });
});
