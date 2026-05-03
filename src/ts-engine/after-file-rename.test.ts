import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { tsAfterFileRename } from "./after-file-rename.js";
import { TsMorphEngine } from "./engine.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("tsAfterFileRename", () => {
  test.override({ fixtureName: FIXTURES.simpleTs.name });

  test("does not touch files outside the workspace boundary", async ({ dir }) => {
    const engine = new TsMorphEngine();
    const narrowDir = path.join(dir, "src", "nested");
    fs.mkdirSync(narrowDir, { recursive: true });
    const outsideFile = path.join(dir, "src/main.ts");
    const originalContent = fs.readFileSync(outsideFile, "utf8");

    const scope = makeScope(narrowDir);
    const oldPath = path.join(dir, "src/utils.ts");
    const newPath = path.join(dir, "src/helpers.ts");
    await tsAfterFileRename(engine, oldPath, newPath, scope);

    expect(scope.modified).not.toContain(outsideFile);
    expect(fs.readFileSync(outsideFile, "utf8")).toBe(originalContent);
  });

  test("does not rewrite files that do not import the old path", async ({ dir }) => {
    const engine = new TsMorphEngine();
    const mainPath = path.join(dir, "src/main.ts");
    const originalContent = fs.readFileSync(mainPath, "utf8");
    const unrelatedOld = path.join(dir, "src/unrelated.ts");
    const unrelatedNew = path.join(dir, "src/other.ts");
    const scope = makeScope(dir);
    await tsAfterFileRename(engine, unrelatedOld, unrelatedNew, scope);
    expect(fs.readFileSync(mainPath, "utf8")).toBe(originalContent);
    expect(scope.modified).not.toContain(mainPath);
  });

  test("skips files already in scope.modified", async ({ dir }) => {
    const engine = new TsMorphEngine();
    const mainPath = path.join(dir, "src/main.ts");
    const originalContent = fs.readFileSync(mainPath, "utf8");
    const utils = path.join(dir, "src/utils.ts");
    const helpers = path.join(dir, "src/helpers.ts");
    const scope = makeScope(dir);
    scope.recordModified(mainPath);
    await tsAfterFileRename(engine, utils, helpers, scope);
    expect(fs.readFileSync(mainPath, "utf8")).toBe(originalContent);
  });

  test("records modified importers in scope when the file is physically renamed", async ({
    dir,
  }) => {
    const engine = new TsMorphEngine();
    const utils = path.join(dir, "src/utils.ts");
    const helpers = path.join(dir, "src/helpers.ts");
    fs.renameSync(utils, helpers);
    const scope = makeScope(dir);
    await tsAfterFileRename(engine, utils, helpers, scope);
    const mainPath = path.join(dir, "src/main.ts");
    expect(scope.modified).toContain(mainPath);
    expect(scope.modified.length).toBeGreaterThan(0);
    expect(scope.skipped).toEqual([]);
  });
});
