/**
 * Tests for TsProvider.afterSymbolMove — the fallback scan that rewrites imports
 * in files outside tsconfig.include (test files, scripts, etc.).
 *
 * These tests are separate from moveSymbol.test.ts to keep that file under the
 * 500-line threshold while still achieving mutation coverage on the fallback scan.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TsProvider } from "../../src/providers/ts.js";
import { cleanup } from "../helpers.js";
import { makeTmpDir, moveWithTs, setupSimpleTs, writeTsConfig } from "./moveSymbol-helpers.js";

describe("moveSymbol fallback scan (out-of-project importers)", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("rewrites a bare specifier (no extension) in an out-of-project file", async () => {
    // Verifies that import { symbol } from "../src/utils" (no extension) is matched.
    const { dir, tsProvider } = setupSimpleTs();
    dirs.push(dir);
    // tests/utils.test.ts already has this form — use it directly
    const result = await moveWithTs(
      tsProvider,
      `${dir}/src/utils.ts`,
      "greetUser",
      `${dir}/src/helpers.ts`,
      dir,
    );
    const content = fs.readFileSync(path.join(dir, "tests/utils.test.ts"), "utf8");
    expect(content).toContain("../src/helpers.js");
    expect(content).not.toContain("../src/utils");
    expect(result.filesModified).toContain(path.join(dir, "tests/utils.test.ts"));
  });

  it("does not rewrite an out-of-project file already rewritten by the ts-morph pass", async () => {
    // Exercises the alreadyModified skip: files that ts-morph already rewrote
    // must not be processed a second time by the fallback scan.
    const tmpDir = makeTmpDir("ns-ms-fallback-skip-");
    dirs.push(tmpDir);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    // tsconfig covers everything so tests/ IS in the ts-morph project
    writeTsConfig(tmpDir, ["**/*.ts"]);
    fs.writeFileSync(
      path.join(tmpDir, "src/utils.ts"),
      "export function add(a: number, b: number): number { return a + b; }\n",
    );
    // consumer.ts is INSIDE the workspace and in the ts-morph project
    const consumerPath = path.join(tmpDir, "src/consumer.ts");
    fs.writeFileSync(consumerPath, 'import { add } from "./utils";\nexport const r = add(1, 2);\n');

    const result = await moveWithTs(
      new TsProvider(),
      path.join(tmpDir, "src/utils.ts"),
      "add",
      path.join(tmpDir, "src/helpers.ts"),
      tmpDir,
    );

    // consumer.ts is rewritten exactly once by ts-morph — it must not appear twice
    const content = fs.readFileSync(consumerPath, "utf8");
    expect(content).toContain('"./helpers.js"');
    // filesModified must contain consumer.ts but only once
    const hits = result.filesModified.filter((f) => f === consumerPath);
    expect(hits).toHaveLength(1);
  });

  it("rewrites a .js-extension specifier in an out-of-project file", async () => {
    // Exercises the JS_TS_PAIRS branch in matchesSourceFile.
    const tmpDir = makeTmpDir("ns-ms-fallback-jsext-");
    dirs.push(tmpDir);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
    // tsconfig covers only src/, so tests/ is out-of-project
    writeTsConfig(tmpDir, ["src/**/*.ts"]);
    fs.writeFileSync(
      path.join(tmpDir, "src/utils.ts"),
      "export function add(a: number, b: number): number { return a + b; }\n",
    );
    // Out-of-project file uses .js extension specifier (ESM style)
    fs.writeFileSync(
      path.join(tmpDir, "tests/consumer.ts"),
      'import { add } from "../src/utils.js";\nconsole.log(add(1, 2));\n',
    );

    const result = await moveWithTs(
      new TsProvider(),
      path.join(tmpDir, "src/utils.ts"),
      "add",
      path.join(tmpDir, "src/helpers.ts"),
      tmpDir,
    );

    const content = fs.readFileSync(path.join(tmpDir, "tests/consumer.ts"), "utf8");
    expect(content).toContain("../src/helpers.js");
    expect(content).not.toContain("../src/utils.js");
    expect(result.filesModified).toContain(path.join(tmpDir, "tests/consumer.ts"));
  });

  it("splits a multi-named-import in an out-of-project file when only one symbol is moved", async () => {
    // Exercises the partial-move branch: import { moved, other } from source
    // becomes { other } from source + { moved } from dest.
    const tmpDir = makeTmpDir("ns-ms-fallback-partial-");
    dirs.push(tmpDir);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
    writeTsConfig(tmpDir, ["src/**/*.ts"]);
    fs.writeFileSync(
      path.join(tmpDir, "src/utils.ts"),
      "export function add(a: number, b: number): number { return a + b; }\nexport function mul(a: number, b: number): number { return a * b; }\n",
    );
    // Out-of-project file imports both symbols
    fs.writeFileSync(
      path.join(tmpDir, "tests/consumer.ts"),
      'import { add, mul } from "../src/utils";\nconsole.log(add(1, 2), mul(3, 4));\n',
    );

    const result = await moveWithTs(
      new TsProvider(),
      path.join(tmpDir, "src/utils.ts"),
      "add",
      path.join(tmpDir, "src/helpers.ts"),
      tmpDir,
    );

    const content = fs.readFileSync(path.join(tmpDir, "tests/consumer.ts"), "utf8");
    // mul stays on the original utils import
    expect(content).toMatch(/import\s*\{[^}]*mul[^}]*\}\s*from\s*["']\.\.\/src\/utils/);
    // add moves to helpers
    expect(content).toMatch(/import\s*\{[^}]*add[^}]*\}\s*from\s*["']\.\.\/src\/helpers\.js/);
    // add must not remain in the utils import
    expect(content).not.toMatch(/import\s*\{[^}]*add[^}]*\}\s*from\s*["']\.\.\/src\/utils/);
    expect(result.filesModified).toContain(path.join(tmpDir, "tests/consumer.ts"));
  });

  it("rewrites a re-export declaration in an out-of-project file", async () => {
    // Exercises the ExportDeclaration branch: export { symbol } from source.
    const tmpDir = makeTmpDir("ns-ms-fallback-reexport-");
    dirs.push(tmpDir);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
    writeTsConfig(tmpDir, ["src/**/*.ts"]);
    fs.writeFileSync(
      path.join(tmpDir, "src/utils.ts"),
      "export function add(a: number, b: number): number { return a + b; }\n",
    );
    // Out-of-project file re-exports the symbol
    fs.writeFileSync(path.join(tmpDir, "tests/barrel.ts"), 'export { add } from "../src/utils";\n');

    const result = await moveWithTs(
      new TsProvider(),
      path.join(tmpDir, "src/utils.ts"),
      "add",
      path.join(tmpDir, "src/helpers.ts"),
      tmpDir,
    );

    const content = fs.readFileSync(path.join(tmpDir, "tests/barrel.ts"), "utf8");
    expect(content).toContain("../src/helpers.js");
    expect(content).not.toContain("../src/utils");
    expect(result.filesModified).toContain(path.join(tmpDir, "tests/barrel.ts"));
  });

  it("does not rewrite an out-of-project file that imports a different symbol from the same source", async () => {
    // Exercises the matching.length === 0 continue: an import from sourceFile that
    // does not import the moved symbol must be left unchanged.
    const tmpDir = makeTmpDir("ns-ms-fallback-nomod-");
    dirs.push(tmpDir);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
    writeTsConfig(tmpDir, ["src/**/*.ts"]);
    fs.writeFileSync(
      path.join(tmpDir, "src/utils.ts"),
      "export function add(a: number, b: number): number { return a + b; }\nexport function mul(a: number, b: number): number { return a * b; }\n",
    );
    // Out-of-project file only imports mul, not add (the symbol being moved)
    const originalContent = 'import { mul } from "../src/utils";\nconsole.log(mul(3, 4));\n';
    fs.writeFileSync(path.join(tmpDir, "tests/consumer.ts"), originalContent);

    await moveWithTs(
      new TsProvider(),
      path.join(tmpDir, "src/utils.ts"),
      "add",
      path.join(tmpDir, "src/helpers.ts"),
      tmpDir,
    );

    // File must be completely unchanged
    const content = fs.readFileSync(path.join(tmpDir, "tests/consumer.ts"), "utf8");
    expect(content).toBe(originalContent);
  });
});
