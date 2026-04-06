import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect } from "vitest";
import { FIXTURES, readFile, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { VolarEngine } from "../plugins/vue/engine.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { moveSymbol } from "./moveSymbol.js";

describe("moveSymbol operation — VolarEngine integration", () => {
  test.override({ fixtureName: FIXTURES.vueProject.name });

  test("moves a composable and updates .vue SFC imports via VolarEngine", async ({ dir }) => {
    const volarCompiler = new VolarEngine(new TsMorphEngine());
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

  test("rewrites imports in a TS file outside tsconfig.include when VolarEngine.moveSymbol is called", async ({
    dir,
  }) => {
    // vue-project fixture tsconfig: include = ["src/**/*.ts", "src/**/*.vue"]
    // A file outside that pattern (e.g. tests/consumer.ts) imports the moved symbol.
    // VolarEngine.moveSymbol delegates to tsEngine.moveSymbol which uses the
    // expanded project graph — the out-of-project file must be rewritten.

    // Create a test file outside tsconfig.include that imports useCounter.
    fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "tests/consumer.ts"),
      'import { useCounter } from "../src/composables/useCounter";\n' +
        "export const c = useCounter();\n",
    );

    const volarCompiler = new VolarEngine(new TsMorphEngine(dir), dir);
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
