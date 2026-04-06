import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, vi } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import type { Engine } from "../ts-engine/types.js";
import { deleteFile } from "./deleteFile.js";

function makeScope(workspace: string): WorkspaceScope {
  return new WorkspaceScope(workspace, new NodeFileSystem());
}

/** Minimal Engine stub — all methods throw unless overridden. */
function makeStubEngine(overrides: Partial<Engine> = {}): Engine {
  return {
    resolveOffset: vi.fn(),
    getRenameLocations: vi.fn(),
    getReferencesAtPosition: vi.fn(),
    getDefinitionAtPosition: vi.fn(),
    getEditsForFileRename: vi.fn(),
    readFile: vi.fn(),
    afterFileRename: vi.fn(),
    afterSymbolMove: vi.fn(),
    moveDirectory: vi.fn(),
    deleteFile: vi.fn(),
    ...overrides,
  } as Engine;
}

describe("deleteFile operation", () => {
  test.override({ fixtureName: FIXTURES.deleteFileTs.name });

  describe("FILE_NOT_FOUND validation", () => {
    test("throws FILE_NOT_FOUND when the target does not exist", async ({ dir }) => {
      const engine = makeStubEngine();

      await expect(
        deleteFile(engine, `${dir}/src/does-not-exist.ts`, makeScope(dir)),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    test("does not call engine.deleteFile when the target is missing", async ({ dir }) => {
      const engineDeleteFile = vi.fn();
      const engine = makeStubEngine({ deleteFile: engineDeleteFile });

      await expect(
        deleteFile(engine, `${dir}/src/does-not-exist.ts`, makeScope(dir)),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });

      expect(engineDeleteFile).not.toHaveBeenCalled();
    });
  });

  describe("SENSITIVE_FILE rejection", () => {
    test("throws SENSITIVE_FILE when the target is a sensitive file", async ({ dir }) => {
      const envFile = path.join(dir, ".env");
      fs.writeFileSync(envFile, "SECRET=abc\n", "utf8");

      const engine = makeStubEngine();

      await expect(deleteFile(engine, envFile, makeScope(dir))).rejects.toMatchObject({
        code: "SENSITIVE_FILE",
      });

      expect(fs.existsSync(envFile)).toBe(true);
    });

    test("does not call engine.deleteFile when the target is sensitive", async ({ dir }) => {
      const envFile = path.join(dir, ".env");
      fs.writeFileSync(envFile, "SECRET=abc\n", "utf8");

      const engineDeleteFile = vi.fn();
      const engine = makeStubEngine({ deleteFile: engineDeleteFile });

      await expect(deleteFile(engine, envFile, makeScope(dir))).rejects.toMatchObject({
        code: "SENSITIVE_FILE",
      });

      expect(engineDeleteFile).not.toHaveBeenCalled();
    });
  });

  describe("result construction from scope", () => {
    test("returns deletedFile as the resolved absolute path", async ({ dir }) => {
      const targetFile = `${dir}/src/target.ts`;
      const engine = new TsMorphEngine();
      const result = await deleteFile(engine, targetFile, makeScope(dir));

      expect(result.deletedFile).toBe(path.resolve(targetFile));
    });

    test("returns filesModified populated by the engine's work", async ({ dir }) => {
      const targetFile = `${dir}/src/target.ts`;
      const modifiedFile = `${dir}/src/importer.ts`;

      const scope = makeScope(dir);
      scope.recordModified(modifiedFile);

      const engineDeleteFile = vi.fn().mockResolvedValue({ importRefsRemoved: 0 });
      const engine = makeStubEngine({ deleteFile: engineDeleteFile });

      const result = await deleteFile(engine, targetFile, scope);

      expect(result.filesModified).toContain(modifiedFile);
      expect(result.filesModified).toStrictEqual(scope.modified);
    });

    test("returns filesSkipped populated by the engine's work", async ({ dir }) => {
      const targetFile = `${dir}/src/target.ts`;
      const skippedFile = `/outside/workspace/file.ts`;

      const scope = makeScope(dir);
      scope.recordSkipped(skippedFile);

      const engineDeleteFile = vi.fn().mockResolvedValue({ importRefsRemoved: 0 });
      const engine = makeStubEngine({ deleteFile: engineDeleteFile });

      const result = await deleteFile(engine, targetFile, scope);

      expect(result.filesSkipped).toContain(skippedFile);
      expect(result.filesSkipped).toStrictEqual(scope.skipped);
    });

    test("returns importRefsRemoved from engine.deleteFile result", async ({ dir }) => {
      const targetFile = path.join(dir, "src", "target.ts");
      const absTarget = path.resolve(targetFile);

      const engineDeleteFile = vi.fn().mockResolvedValue({ importRefsRemoved: 42 });
      const engine = makeStubEngine({ deleteFile: engineDeleteFile });

      const scope = makeScope(dir);
      const result = await deleteFile(engine, targetFile, scope);

      expect(result.importRefsRemoved).toBe(42);
      expect(engineDeleteFile).toHaveBeenCalledWith(absTarget, scope);
    });

    test("passes the resolved absolute path to engine.deleteFile", async ({ dir }) => {
      const targetFile = `${dir}/src/target.ts`;
      const absTarget = path.resolve(targetFile);

      const engineDeleteFile = vi.fn().mockResolvedValue({ importRefsRemoved: 0 });
      const engine = makeStubEngine({ deleteFile: engineDeleteFile });

      await deleteFile(engine, targetFile, makeScope(dir));

      expect(engineDeleteFile).toHaveBeenCalledWith(absTarget, expect.any(WorkspaceScope));
    });
  });
});
