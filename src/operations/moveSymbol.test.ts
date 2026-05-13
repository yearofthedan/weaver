import * as path from "node:path";
import { describe, expect, vi } from "vitest";
import { fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { makeMockCompiler } from "../ts-engine/__testHelpers__/mock-compiler.js";
import { moveSymbol } from "./moveSymbol.js";

const SYMBOL = "greetUser";
const SOURCE_REL = "src/utils.ts";
const SOURCE_CONTENT = "export function greetUser(name: string): string { return name; }\n";
const DEST_REL = "src/helpers.ts";

describe("moveSymbol operation (thin orchestrator)", () => {
  describe("orchestrator delegates to engine", () => {
    test("calls engine.moveSymbol with resolved absolute paths, symbol, scope, and options", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({ [SOURCE_REL]: SOURCE_CONTENT });
      const source = path.join(dir, SOURCE_REL);
      const dest = path.join(dir, DEST_REL);
      const scope = new WorkspaceScope(dir, new NodeFileSystem());
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

    test("forwards options to engine.moveSymbol", async ({ seedInlineFixture }) => {
      const dir = await seedInlineFixture({ [SOURCE_REL]: SOURCE_CONTENT });
      const source = path.join(dir, SOURCE_REL);
      const dest = path.join(dir, DEST_REL);
      const scope = new WorkspaceScope(dir, new NodeFileSystem());
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
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({ [SOURCE_REL]: SOURCE_CONTENT });
      const source = path.join(dir, SOURCE_REL);
      const dest = path.join(dir, DEST_REL);
      const scope = new WorkspaceScope(dir, new NodeFileSystem());
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
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({ [SOURCE_REL]: SOURCE_CONTENT });
      const source = path.join(dir, SOURCE_REL);
      const dest = path.join(dir, DEST_REL);
      const scope = new WorkspaceScope(dir, new NodeFileSystem());
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
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({ [SOURCE_REL]: SOURCE_CONTENT });
      const source = path.join(dir, SOURCE_REL);
      const dest = path.join(dir, DEST_REL);
      const scope = new WorkspaceScope(dir, new NodeFileSystem());
      const engine = makeMockCompiler({
        moveSymbol: vi
          .fn()
          .mockImplementation((_src: string, _sym: string, _dst: string, s: WorkspaceScope) => {
            s.recordModified(source);
            s.recordModified(dest);
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
    test("throws FILE_NOT_FOUND when the source file does not exist", async ({ dir }) => {
      const scope = new WorkspaceScope(dir, new NodeFileSystem());
      const engine = makeMockCompiler();
      const missingSource = path.join(dir, "src/doesNotExist.ts");
      const dest = path.join(dir, DEST_REL);

      await expect(moveSymbol(engine, missingSource, SYMBOL, dest, scope)).rejects.toMatchObject({
        code: "FILE_NOT_FOUND",
      });
    });
  });
});
