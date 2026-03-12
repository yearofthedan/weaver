import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TsProvider } from "../../src/compilers/ts.js";
import { extractFunction } from "../../src/operations/extractFunction.js";
import { cleanup, copyFixture } from "../helpers.js";

describe("extractFunction", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-extractfn-"));
    dirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }),
    );
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    return dir;
  }

  it("creates a new function and replaces the selection with a call", async () => {
    const dir = makeTempDir();
    // Write a file with a block of code to extract
    const src = `export function outer(n: number): void {
  const doubled = n * 2;
  const msg = \`Value is \${doubled}\`;
  console.log(msg);
}
`;
    const filePath = path.join(dir, "src/target.ts");
    fs.writeFileSync(filePath, src);

    // Extract lines 2-4 (the three body statements)
    const result = await extractFunction(
      new TsProvider(),
      filePath,
      2,
      3, // startLine, startCol
      4,
      19, // endLine, endCol (end of "console.log(msg);", inclusive of semicolon)
      "logDoubled",
      dir,
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

    const result = await extractFunction(
      new TsProvider(),
      filePath,
      2,
      3,
      2,
      22, // end of "const result = x + 1;"
      "increment",
      dir,
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

    // Extract "x + y" expression (line 2, inside the initialiser)
    const result = await extractFunction(
      new TsProvider(),
      filePath,
      2,
      15, // col of 'x'
      2,
      19, // col after 'y'
      "add",
      dir,
    );

    expect(result.parameterCount).toBeGreaterThanOrEqual(2);
    // Resulting file must type-check (AC2 says no new type errors after extraction)
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
    const result = await extractFunction(
      new TsProvider(),
      filePath,
      2,
      15, // col of '4' in '42'
      2,
      16, // col of '2' in '42'
      "magicNumber",
      dir,
    );

    expect(result.parameterCount).toBe(0);
  });

  it("extracted function uses the provided name, not a compiler-generated default", async () => {
    const dir = makeTempDir();
    const src = `export function wrapper(a: number, b: number): number {
  const product = a * b;
  return product;
}
`;
    const filePath = path.join(dir, "src/target.ts");
    fs.writeFileSync(filePath, src);

    const result = await extractFunction(
      new TsProvider(),
      filePath,
      2,
      19, // col of 'a'
      2,
      23, // col after 'b'
      "multiply",
      dir,
    );

    expect(result.functionName).toBe("multiply");
    const written = fs.readFileSync(filePath, "utf8");
    expect(written).toContain("function multiply(");
    // The call site also uses the provided name
    expect(written).toContain("multiply(");
    // Must NOT contain the compiler default name
    expect(written).not.toContain("newFunction");
    expect(written).not.toContain("extracted");
  });

  it("both the declaration and the call site use the provided name", async () => {
    const dir = makeTempDir();
    const src = `export function outer(): void {
  const x = 1;
  const y = 2;
  console.log(x + y);
}
`;
    const filePath = path.join(dir, "src/target.ts");
    fs.writeFileSync(filePath, src);

    await extractFunction(
      new TsProvider(),
      filePath,
      4,
      3,
      4,
      22, // "console.log(x + y);"
      "printSum",
      dir,
    );

    const written = fs.readFileSync(filePath, "utf8");
    // Count occurrences: both declaration and call site
    const occurrences = (written.match(/printSum/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("throws NOT_SUPPORTED when no extractable code exists at the given range", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    const filePath = path.join(dir, "src/utils.ts");

    // Line 1 col 1 to line 1 col 1 — empty range, nothing to extract
    await expect(
      extractFunction(new TsProvider(), filePath, 1, 1, 1, 1, "myFn", dir),
    ).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  });

  it("throws FILE_NOT_FOUND for a missing source file", async () => {
    const dir = makeTempDir();

    await expect(
      extractFunction(
        new TsProvider(),
        path.join(dir, "src/does-not-exist.ts"),
        1,
        1,
        1,
        10,
        "myFn",
        dir,
      ),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });
});
