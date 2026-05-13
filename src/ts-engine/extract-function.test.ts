import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { VolarEngine } from "../plugins/vue/engine.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "./engine.js";
import { tsExtractFunction } from "./extract-function.js";

const TSCONFIG = JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] });

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("tsExtractFunction", () => {
  test("creates a new function and replaces the selection with a call", async ({
    dir,
    seedInlineFixture,
  }) => {
    await seedInlineFixture({
      "tsconfig.json": TSCONFIG,
      "src/target.ts": `export function outer(n: number): void {
  const doubled = n * 2;
  const msg = \`Value is \${doubled}\`;
  console.log(msg);
}
`,
    });
    const filePath = path.join(dir, "src/target.ts");

    const result = await tsExtractFunction(
      new TsMorphEngine(),
      filePath,
      2,
      3,
      4,
      19,
      "logDoubled",
      makeScope(dir),
    );

    expect(result.filesModified).toEqual([filePath]);
    expect(result.filesSkipped).toEqual([]);
    expect(result.functionName).toBe("logDoubled");
    const written = fs.readFileSync(filePath, "utf8");
    expect(written).toContain("function logDoubled");
    expect(written).toContain("logDoubled(");
  });

  test("filesModified contains exactly the source file — no other files are written", async ({
    dir,
    seedInlineFixture,
  }) => {
    await seedInlineFixture({
      "tsconfig.json": TSCONFIG,
      "src/target.ts": `export function run(x: number): number {
  const result = x + 1;
  return result;
}
`,
    });
    const filePath = path.join(dir, "src/target.ts");

    const result = await tsExtractFunction(
      new TsMorphEngine(),
      filePath,
      2,
      3,
      2,
      22,
      "increment",
      makeScope(dir),
    );

    expect(result.filesModified).toHaveLength(1);
    expect(result.filesModified[0]).toBe(filePath);
    expect(result.filesSkipped).toEqual([]);
  });

  test("parameterCount reflects the number of parameters inferred by the compiler", async ({
    dir,
    seedInlineFixture,
  }) => {
    await seedInlineFixture({
      "tsconfig.json": TSCONFIG,
      "src/target.ts": `export function compute(x: number, y: number): number {
  const sum = x + y;
  return sum;
}
`,
    });
    const filePath = path.join(dir, "src/target.ts");

    const result = await tsExtractFunction(
      new TsMorphEngine(),
      filePath,
      2,
      15,
      2,
      19,
      "add",
      makeScope(dir),
    );

    expect(result.parameterCount).toBeGreaterThanOrEqual(2);
    const written = fs.readFileSync(filePath, "utf8");
    expect(written).toContain("function add(");
  });

  test("parameterCount is 0 when the extracted code references no outer-scope variables", async ({
    dir,
    seedInlineFixture,
  }) => {
    await seedInlineFixture({
      "tsconfig.json": TSCONFIG,
      "src/target.ts": `export function run(): number {
  const val = 42;
  return val;
}
`,
    });
    const filePath = path.join(dir, "src/target.ts");

    const result = await tsExtractFunction(
      new TsMorphEngine(),
      filePath,
      2,
      15,
      2,
      16,
      "magicNumber",
      makeScope(dir),
    );

    expect(result.parameterCount).toBe(0);
  });

  test("extracted function uses the provided name and is written to the file", async ({
    dir,
    seedInlineFixture,
  }) => {
    await seedInlineFixture({
      "tsconfig.json": TSCONFIG,
      "src/target.ts": `export function wrapper(a: number, b: number): number {
  const product = a * b;
  return product;
}
`,
    });
    const filePath = path.join(dir, "src/target.ts");

    const result = await tsExtractFunction(
      new TsMorphEngine(),
      filePath,
      2,
      19,
      2,
      23,
      "multiply",
      makeScope(dir),
    );

    expect(result.functionName).toBe("multiply");
    const written = fs.readFileSync(filePath, "utf8");
    expect(written).toContain("function multiply(");
  });

  test("throws NOT_SUPPORTED when no extractable code exists at the given range", async ({
    dir,
    seedNamedFixture,
  }) => {
    await seedNamedFixture(FIXTURES.simpleTs.name);
    const filePath = path.join(dir, "src/utils.ts");
    await expect(
      tsExtractFunction(new TsMorphEngine(), filePath, 1, 1, 1, 1, "myFn", makeScope(dir)),
    ).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  });
});

describe("VolarEngine.extractFunction", () => {
  test("extracts a function from a <script setup> block and preserves all other SFC blocks", async ({
    dir,
    seedInlineFixture,
  }) => {
    const vueContent = `<script setup lang="ts">
const x = 1;
const doubled = x * 2;
console.log(doubled);
</script>
<template>
  <div>hello</div>
</template>
`;
    await seedInlineFixture({ "Comp.vue": vueContent });
    const filePath = path.join(dir, "Comp.vue");

    const engine = new VolarEngine(new TsMorphEngine());
    const scope = makeScope(dir);

    const result = await engine.extractFunction(filePath, 3, 1, 4, 21, "processValue", scope);

    expect(result.filesModified).toEqual([filePath]);
    expect(result.filesSkipped).toEqual([]);
    expect(result.functionName).toBe("processValue");

    const written = fs.readFileSync(filePath, "utf8");
    expect(written).toContain("function processValue");
    expect(written).toContain("processValue(");
    expect((written.match(/<script setup/g) ?? []).length).toBe(1);
    expect((written.match(/<template>/g) ?? []).length).toBe(1);
    expect(written).toContain("<div>hello</div>");
    expect(written.indexOf("</script>")).toBeLessThan(written.indexOf("<template>"));
  });

  test("parameterCount reflects the number of parameters inferred by the compiler", async ({
    dir,
    seedInlineFixture,
  }) => {
    const vueContent = `<script setup lang="ts">
function init() {
  const a = 10;
  const b = 20;
  const sum = a + b;
  console.log(sum);
}
init();
</script>
<template><div></div></template>
`;
    await seedInlineFixture({ "Comp.vue": vueContent });
    const filePath = path.join(dir, "Comp.vue");

    const engine = new VolarEngine(new TsMorphEngine());
    const scope = makeScope(dir);

    const result = await engine.extractFunction(filePath, 5, 3, 6, 19, "compute", scope);

    expect(result.parameterCount).toBeGreaterThanOrEqual(1);
    const written = fs.readFileSync(filePath, "utf8");
    expect(written).toContain("function compute(");
  });

  test("throws NOT_SUPPORTED when the selection coordinates fall before the <script setup> content", async ({
    dir,
    seedInlineFixture,
  }) => {
    const vueContent = `<script setup lang="ts">
const x = 1;
</script>
<template><div></div></template>
`;
    await seedInlineFixture({ "Edge.vue": vueContent });
    const filePath = path.join(dir, "Edge.vue");

    const engine = new VolarEngine(new TsMorphEngine());
    const scope = makeScope(dir);

    await expect(engine.extractFunction(filePath, 1, 1, 1, 5, "fn", scope)).rejects.toMatchObject({
      code: "NOT_SUPPORTED",
      message: expect.stringContaining("outside the <script setup> block"),
    });
  });

  test("throws NOT_SUPPORTED when the start coordinate is inside the <script setup> tag but end is inside content", async ({
    dir,
    seedInlineFixture,
  }) => {
    const vueContent = `<script setup lang="ts">
const x = 1;
</script>
<template><div></div></template>
`;
    await seedInlineFixture({ "Edge.vue": vueContent });
    const filePath = path.join(dir, "Edge.vue");

    const engine = new VolarEngine(new TsMorphEngine());
    const scope = makeScope(dir);

    await expect(engine.extractFunction(filePath, 1, 1, 2, 5, "fn", scope)).rejects.toMatchObject({
      code: "NOT_SUPPORTED",
      message: expect.stringContaining("outside the <script setup> block"),
    });
  });

  test("throws NOT_SUPPORTED when the end coordinate is inside the <script setup> tag but start is inside content", async ({
    dir,
    seedInlineFixture,
  }) => {
    const vueContent = `<script setup lang="ts">
const x = 1;
</script>
<template><div></div></template>
`;
    await seedInlineFixture({ "Edge.vue": vueContent });
    const filePath = path.join(dir, "Edge.vue");

    const engine = new VolarEngine(new TsMorphEngine());
    const scope = makeScope(dir);

    await expect(engine.extractFunction(filePath, 2, 1, 1, 1, "fn", scope)).rejects.toMatchObject({
      code: "NOT_SUPPORTED",
      message: expect.stringContaining("outside the <script setup> block"),
    });
  });

  test("throws NOT_SUPPORTED when the selection line is beyond the end of the file", async ({
    dir,
    seedInlineFixture,
  }) => {
    const vueContent = `<script setup lang="ts">
const x = 1;
</script>
<template><div></div></template>
`;
    await seedInlineFixture({ "Edge.vue": vueContent });
    const filePath = path.join(dir, "Edge.vue");

    const engine = new VolarEngine(new TsMorphEngine());
    const scope = makeScope(dir);

    await expect(
      engine.extractFunction(filePath, 999, 1, 999, 5, "fn", scope),
    ).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  });

  test("throws NOT_SUPPORTED for a .vue file without a <script setup> block", async ({
    dir,
    seedInlineFixture,
  }) => {
    await seedInlineFixture({ "NoScript.vue": `<template><div>hello</div></template>` });
    const filePath = path.join(dir, "NoScript.vue");

    const engine = new VolarEngine(new TsMorphEngine());
    const scope = makeScope(dir);

    await expect(engine.extractFunction(filePath, 1, 1, 1, 10, "fn", scope)).rejects.toMatchObject({
      code: "NOT_SUPPORTED",
    });
  });
});
