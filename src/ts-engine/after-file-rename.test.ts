import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { tsAfterFileRename } from "./after-file-rename.js";
import { TsMorphEngine } from "./engine.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("tsAfterFileRename", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = FIXTURES.simpleTs.name) {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  it("does not touch files outside the workspace boundary", async () => {
    const dir = setup();
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

  it("does not rewrite files that do not import the old path", async () => {
    const dir = setup();
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

  it("skips files already in scope.modified", async () => {
    const dir = setup();
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

  it("records modified importers in scope when the file is physically renamed", async () => {
    const dir = setup();
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
