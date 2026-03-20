import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES, readFile } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { VolarCompiler } from "../plugins/vue/compiler.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { moveSymbol } from "./moveSymbol.js";

describe("moveSymbol operation — VolarCompiler integration", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("moves a composable and updates .vue SFC imports via VolarCompiler", async () => {
    const dir = copyFixture(FIXTURES.vueProject.name);
    dirs.push(dir);
    const tsCompiler = new TsMorphEngine();
    const volarCompiler = new VolarCompiler();
    const srcPath = `${dir}/src/composables/useCounter.ts`;
    const dstPath = `${dir}/src/shared.ts`;
    const scope = new WorkspaceScope(dir, new NodeFileSystem());

    const result = await moveSymbol(
      tsCompiler,
      volarCompiler,
      srcPath,
      "useCounter",
      dstPath,
      scope,
    );

    expect(result.symbolName).toBe("useCounter");
    expect(readFile(dir, "src/shared.ts")).toContain("useCounter");
    expect(readFile(dir, "src/composables/useCounter.ts")).not.toContain("useCounter");
    expect(readFile(dir, "src/main.ts")).toContain('"./shared.js"');
    expect(readFile(dir, "src/main.ts")).not.toContain("composables/useCounter");
    expect(readFile(dir, "src/App.vue")).toContain("./shared.js");
    expect(readFile(dir, "src/App.vue")).not.toContain("composables/useCounter");
    expect(result.filesModified).toContain(dstPath);
  }, 30_000);
});
