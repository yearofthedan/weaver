import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { moveFile } from "./moveFile.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("moveFile operation - TsMorphEngine", () => {
  test.override({ fixtureName: FIXTURES.simpleTs.name });

  test("throws FILE_NOT_FOUND for non-existent source", async ({ dir }) => {
    const compiler = new TsMorphEngine();

    await expect(
      moveFile(compiler, `${dir}/src/doesNotExist.ts`, `${dir}/lib/utils.ts`, makeScope(dir)),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });
});
