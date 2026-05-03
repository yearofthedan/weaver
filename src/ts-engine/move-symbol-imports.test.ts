/**
 * Tests for tsMoveSymbol — import rewriting orchestration.
 *
 * Covered here: orchestration (which files get scanned as importers, scope
 * tracking across multiple files). Rewrite edge cases (partial move, merge,
 * no-op when symbol not imported) are covered by ImportRewriter unit tests.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "./engine.js";
import { tsMoveSymbol } from "./move-symbol.js";

function makeScope(root: string): WorkspaceScope {
  return new WorkspaceScope(root, new NodeFileSystem());
}

describe("tsMoveSymbol — import rewriting", () => {
  test.override({ fixtureName: FIXTURES.multiImporter.name });

  test("updates all importers when multiple files import the moved symbol", async ({ dir }) => {
    const tsCompiler = new TsMorphEngine();
    const scope = makeScope(dir);

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
