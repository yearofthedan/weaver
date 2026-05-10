import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { VolarEngine } from "../plugins/vue/engine.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "./engine.js";
import { tsExtractFunction } from "./extract-function.js";

describe("tsExtractFunction", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-ts-extractfn-"));
    dirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }),
    );
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    return dir;
  }

  function makeScope(dir: string): WorkspaceScope {
    return new WorkspaceScope(dir, new NodeFileSystem());
  }

  it("creates a new function and replaces the selection with a call", async () => {
    const dir = makeTempDir();
    const src = `export function outer(n: number): void {
  const doubled = n * 2;
  const msg = \`Value is \${doubled}\`;
  console.log(msg);
}
`;
    const filePath = path.join(dir, "src/target.ts");
    fs.writeFileSync(filePath, src);

    const result = await tsExtractFunction(
      new TsMorphEngine(),
      filePath,
      2,
      3, // startLine, startCol
      4,
      19, // endLine, endCol (end of "console.log(msg);", inclusive of semicolon)
      "logDoubled",
      makeScope(dir),
    );

    expect(result.filesModified).toEqual([filePath]);
    expect(result.filesSkipped).toEqual([]);
    expect(result.functionName).toBe("logDoubled");
    // The file must contain the new function
    const written = fs.readFileSync(filePath, "utf8");
    expect(written).toContain("function logDoubled");
    // The outer function body must contain a call to logDoubled
    expect(written).toContain("logDoubled(");
  });

  it("filesModified contains exactly the source file — no other files are written", async () => {
    const dir = makeTempDir();
    const src = `export function run(x: number): number {
  const result = x + 1;
  return result;
}
`;
    const filePath = path.join(dir, "src/target.ts");
    fs.writeFileSync(filePath, src);

    const result = await tsExtractFunction(
      new TsMorphEngine(),
      filePath,
      2,
      3,
      2,
      22, // end of "const result = x + 1;"
      "increment",
      makeScope(dir),
    );

    expect(result.filesModified).toHaveLength(1);
    expect(result.filesModified[0]).toBe(filePath);
    expect(result.filesSkipped).toEqual([]);
  });

  it("parameterCount reflects the number of parameters inferred by the compiler", async () => {
    const dir = makeTempDir();
    // Selection references two outer-scope variables → extracted fn should have 2 params
    const src = `export function compute(x: number, y: number): number {
  const sum = x + y;
  return sum;
}
`;
    const filePath = path.join(dir, "src/target.ts");
    fs.writeFileSync(filePath, src);

    const result = await tsExtractFunction(
      new TsMorphEngine(),
      filePath,
      2,
      15, // col of 'x'
      2,
      19, // col after 'y'
      "add",
      makeScope(dir),
    );

    expect(result.parameterCount).toBeGreaterThanOrEqual(2);
    const written = fs.readFileSync(filePath, "utf8");
    expect(written).toContain("function add(");
  });

  it("parameterCount is 0 when the extracted code references no outer-scope variables", async () => {
    const dir = makeTempDir();
    const src = `export function run(): number {
  const val = 42;
  return val;
}
`;
    const filePath = path.join(dir, "src/target.ts");
    fs.writeFileSync(filePath, src);

    // Extract "42" (a literal — no outer references)
    const result = await tsExtractFunction(
      new TsMorphEngine(),
      filePath,
      2,
      15, // col of '4' in '42'
      2,
      16, // col of '2' in '42'
      "magicNumber",
      makeScope(dir),
    );

    expect(result.parameterCount).toBe(0);
  });

  it("extracted function uses the provided name and is written to the file", async () => {
    const dir = makeTempDir();
    const src = `export function wrapper(a: number, b: number): number {
  const product = a * b;
  return product;
}
`;
    const filePath = path.join(dir, "src/target.ts");
    fs.writeFileSync(filePath, src);

    const result = await tsExtractFunction(
      new TsMorphEngine(),
      filePath,
      2,
      19, // col of 'a'
      2,
      23, // col after 'b'
      "multiply",
      makeScope(dir),
    );

    expect(result.functionName).toBe("multiply");
    const written = fs.readFileSync(filePath, "utf8");
    expect(written).toContain("function multiply(");
  });

  it("throws NOT_SUPPORTED when no extractable code exists at the given range", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    try {
      const filePath = path.join(dir, "src/utils.ts");
      // Line 1 col 1 to line 1 col 1 — empty range, nothing to extract
      await expect(
        tsExtractFunction(new TsMorphEngine(), filePath, 1, 1, 1, 1, "myFn", makeScope(dir)),
      ).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    } finally {
      cleanup(dir);
    }
  });
});

describe("VolarEngine.extractFunction", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-vue-extractfn-"));
    dirs.push(dir);
    return dir;
  }

  it("extracts a function from a <script setup> block and preserves all other SFC blocks", async () => {
    const dir = makeTempDir();
    const vueContent = `<script setup lang="ts">
const x = 1;
const doubled = x * 2;
console.log(doubled);
</script>
<template>
  <div>hello</div>
</template>
`;
    const filePath = path.join(dir, "Comp.vue");
    fs.writeFileSync(filePath, vueContent);

    const engine = new VolarEngine(new TsMorphEngine());
    const scope = new WorkspaceScope(dir, new NodeFileSystem());

    // Extract lines 3-4: "const doubled = x * 2;\nconsole.log(doubled);"
    const result = await engine.extractFunction(filePath, 3, 1, 4, 21, "processValue", scope);

    expect(result.filesModified).toEqual([filePath]);
    expect(result.filesSkipped).toEqual([]);
    expect(result.functionName).toBe("processValue");

    const written = fs.readFileSync(filePath, "utf8");
    expect(written).toContain("function processValue");
    expect(written).toContain("processValue(");
    // Each SFC block must appear exactly once — a faulty splice would duplicate them
    expect((written.match(/<script setup/g) ?? []).length).toBe(1);
    expect((written.match(/<template>/g) ?? []).length).toBe(1);
    expect(written).toContain("<div>hello</div>");
    // Script block must come before template block
    expect(written.indexOf("</script>")).toBeLessThan(written.indexOf("<template>"));
  });

  it("parameterCount reflects the number of parameters inferred by the compiler", async () => {
    const dir = makeTempDir();
    // Variables must be local to a function — module-scope variables are directly accessible
    // and do not become parameters in the extracted function.
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
    const filePath = path.join(dir, "Comp.vue");
    fs.writeFileSync(filePath, vueContent);

    const engine = new VolarEngine(new TsMorphEngine());
    const scope = new WorkspaceScope(dir, new NodeFileSystem());

    // Extract lines 5-6 (inside init()): "const sum = a + b;\nconsole.log(sum);" — references a and b
    const result = await engine.extractFunction(filePath, 5, 3, 6, 19, "compute", scope);

    expect(result.parameterCount).toBeGreaterThanOrEqual(1);
    const written = fs.readFileSync(filePath, "utf8");
    expect(written).toContain("function compute(");
  });

  it("throws NOT_SUPPORTED when the selection coordinates fall before the <script setup> content", async () => {
    const dir = makeTempDir();
    const vueContent = `<script setup lang="ts">
const x = 1;
</script>
<template><div></div></template>
`;
    const filePath = path.join(dir, "Edge.vue");
    fs.writeFileSync(filePath, vueContent);

    const engine = new VolarEngine(new TsMorphEngine());
    const scope = new WorkspaceScope(dir, new NodeFileSystem());

    // Line 1, col 1 points to the opening <script setup> tag itself — before the content starts.
    // After subtracting contentOffset the resulting offset is negative.
    await expect(engine.extractFunction(filePath, 1, 1, 1, 5, "fn", scope)).rejects.toMatchObject({
      code: "NOT_SUPPORTED",
      message: expect.stringContaining("outside the <script setup> block"),
    });
  });

  it("throws NOT_SUPPORTED when the selection line is beyond the end of the file", async () => {
    const dir = makeTempDir();
    const vueContent = `<script setup lang="ts">
const x = 1;
</script>
<template><div></div></template>
`;
    const filePath = path.join(dir, "Edge.vue");
    fs.writeFileSync(filePath, vueContent);

    const engine = new VolarEngine(new TsMorphEngine());
    const scope = new WorkspaceScope(dir, new NodeFileSystem());

    await expect(
      engine.extractFunction(filePath, 999, 1, 999, 5, "fn", scope),
    ).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  });

  it("throws NOT_SUPPORTED for a .vue file without a <script setup> block", async () => {
    const dir = makeTempDir();
    const vueContent = `<template><div>hello</div></template>`;
    const filePath = path.join(dir, "NoScript.vue");
    fs.writeFileSync(filePath, vueContent);

    const engine = new VolarEngine(new TsMorphEngine());
    const scope = new WorkspaceScope(dir, new NodeFileSystem());

    await expect(engine.extractFunction(filePath, 1, 1, 1, 10, "fn", scope)).rejects.toMatchObject({
      code: "NOT_SUPPORTED",
    });
  });
});
