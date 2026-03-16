/**
 * Tests for tsMoveSymbol — import rewriting orchestration.
 *
 * Covered here: orchestration (which files get scanned as importers, scope
 * tracking across multiple files). Rewrite edge cases (partial move, merge,
 * no-op when symbol not imported) are covered by ImportRewriter unit tests.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../../src/__testHelpers__/helpers.js";
import { TsMorphCompiler } from "../../src/compilers/ts.js";
import { tsMoveSymbol } from "../../src/compilers/ts-move-symbol.js";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";

function makeScope(root: string): WorkspaceScope {
  return new WorkspaceScope(root, new NodeFileSystem());
}

function setupMultiImporter(): { dir: string; tsCompiler: TsMorphCompiler; scope: WorkspaceScope } {
  const dir = copyFixture(FIXTURES.multiImporter.name);
  return { dir, tsCompiler: new TsMorphCompiler(), scope: makeScope(dir) };
}

describe("tsMoveSymbol — import rewriting", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("updates all importers when multiple files import the moved symbol", async () => {
    const { dir, tsCompiler, scope } = setupMultiImporter();
    dirs.push(dir);

    await tsMoveSymbol(
      tsCompiler,
      path.join(dir, "src/utils.ts"),
      "add",
      path.join(dir, "src/helpers.ts"),
      scope,
    );

    const featureA = fs.readFileSync(path.join(dir, "src/featureA.ts"), "utf8");
    const featureB = fs.readFileSync(path.join(dir, "src/featureB.ts"), "utf8");
    expect(featureA).toContain('"./helpers.js"');
    expect(featureB).toContain('"./helpers.js"');
    expect(scope.modified).toContain(path.join(dir, "src/featureA.ts"));
    expect(scope.modified).toContain(path.join(dir, "src/featureB.ts"));
  });
});
