import * as fs from "node:fs";
import * as path from "node:path";
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
    const volarCompiler = new VolarCompiler(new TsMorphEngine());
    const srcPath = `${dir}/src/composables/useCounter.ts`;
    const dstPath = `${dir}/src/shared.ts`;
    const scope = new WorkspaceScope(dir, new NodeFileSystem());

    const result = await moveSymbol(volarCompiler, srcPath, "useCounter", dstPath, scope);

    expect(result.symbolName).toBe("useCounter");
    expect(readFile(dir, "src/shared.ts")).toContain("useCounter");
    expect(readFile(dir, "src/composables/useCounter.ts")).not.toContain("useCounter");
    expect(readFile(dir, "src/main.ts")).toContain('"./shared.js"');
    expect(readFile(dir, "src/main.ts")).not.toContain("composables/useCounter");
    expect(readFile(dir, "src/App.vue")).toContain("./shared.js");
    expect(readFile(dir, "src/App.vue")).not.toContain("composables/useCounter");
    expect(result.filesModified).toContain(dstPath);
  }, 30_000);

  it("rewrites imports in a TS file outside tsconfig.include when VolarCompiler.moveSymbol is called", async () => {
    // vue-project fixture tsconfig: include = ["src/**/*.ts", "src/**/*.vue"]
    // A file outside that pattern (e.g. tests/consumer.ts) imports the moved symbol.
    // VolarCompiler.moveSymbol delegates to tsEngine.moveSymbol which includes the
    // fallback scan — the out-of-project file must be rewritten.
    const dir = copyFixture(FIXTURES.vueProject.name);
    dirs.push(dir);

    // Create a test file outside tsconfig.include that imports useCounter.
    fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "tests/consumer.ts"),
      'import { useCounter } from "../src/composables/useCounter";\n' +
        "export const c = useCounter();\n",
    );

    const volarCompiler = new VolarCompiler(new TsMorphEngine());
    const srcPath = `${dir}/src/composables/useCounter.ts`;
    const dstPath = `${dir}/src/shared.ts`;
    const scope = new WorkspaceScope(dir, new NodeFileSystem());

    const result = await moveSymbol(volarCompiler, srcPath, "useCounter", dstPath, scope);

    const consumerContent = fs.readFileSync(path.join(dir, "tests/consumer.ts"), "utf8");
    expect(consumerContent).toContain("../src/shared.js");
    expect(consumerContent).not.toContain("composables/useCounter");
    expect(result.filesModified).toContain(path.join(dir, "tests/consumer.ts"));
  }, 30_000);
});
