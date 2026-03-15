import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, readFile } from "../../src/__testHelpers__/helpers.js";
import { TsMorphCompiler } from "../../src/compilers/ts.js";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { moveSymbol } from "../../src/operations/moveSymbol.js";
import { VolarCompiler } from "../../src/plugins/vue/compiler.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";

describe("moveSymbol operation — VolarCompiler integration", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("moves a composable and updates .vue SFC imports via VolarCompiler", async () => {
    const dir = copyFixture("vue-project");
    dirs.push(dir);
    const tsCompiler = new TsMorphCompiler();
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
