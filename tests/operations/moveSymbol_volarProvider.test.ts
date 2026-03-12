import { afterEach, describe, expect, it } from "vitest";
import { TsProvider } from "../../src/compilers/ts.js";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { moveSymbol } from "../../src/operations/moveSymbol.js";
import { VolarProvider } from "../../src/plugins/vue/compiler.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";
import { cleanup, copyFixture, readFile } from "../helpers.js";

describe("moveSymbol operation — VolarProvider integration", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("moves a composable and updates .vue SFC imports via VolarProvider", async () => {
    const dir = copyFixture("vue-project");
    dirs.push(dir);
    const tsProvider = new TsProvider();
    const volarProvider = new VolarProvider();
    const srcPath = `${dir}/src/composables/useCounter.ts`;
    const dstPath = `${dir}/src/shared.ts`;
    const scope = new WorkspaceScope(dir, new NodeFileSystem());

    const result = await moveSymbol(
      tsProvider,
      volarProvider,
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
