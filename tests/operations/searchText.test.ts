import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../../src/__testHelpers__/helpers.js";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { globToRegex, searchText } from "../../src/operations/searchText.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("globToRegex", () => {
  it("matches basename when pattern has no slash (prepends **/ internally)", () => {
    // "*.ts" → "**/\*.ts" → regex ^.*/[^/]*\.ts$ — matches any dir/basename.ts
    const re = globToRegex("*.ts");
    expect(re.test("src/foo.ts")).toBe(true);
    expect(re.test("deep/nested/foo.ts")).toBe(true);
    expect(re.test("src/foo.tsx")).toBe(false);
    expect(re.test("src/foo.js")).toBe(false);
  });

  it("matches full relative path when pattern includes a slash", () => {
    const re = globToRegex("src/*.ts");
    expect(re.test("src/foo.ts")).toBe(true);
    expect(re.test("lib/foo.ts")).toBe(false);
    expect(re.test("src/nested/foo.ts")).toBe(false);
  });

  it("** matches any number of path segments", () => {
    const re = globToRegex("**/*.test.ts");
    expect(re.test("tests/utils/foo.test.ts")).toBe(true);
    expect(re.test("src/foo.test.ts")).toBe(true);
    expect(re.test("src/foo.ts")).toBe(false);
  });

  it("? matches exactly one non-slash character", () => {
    const re = globToRegex("src/?.ts");
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("src/ab.ts")).toBe(false);
    expect(re.test("src/.ts")).toBe(false);
  });
});

describe("searchText operation", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("finds all occurrences of a pattern across workspace files", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    const result = await searchText("greetUser", makeScope(dir));

    expect(result.truncated).toBe(false);
    expect(result.matches.length).toBeGreaterThanOrEqual(2);

    const files = result.matches.map((m) => m.file);
    expect(files.some((f) => f.endsWith("utils.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("main.ts"))).toBe(true);

    for (const match of result.matches) {
      expect(match.line).toBeGreaterThan(0);
      expect(match.col).toBeGreaterThan(0);
      expect(match.matchText).toBe("greetUser");
    }
  });

  it("returns context lines when requested", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    const result = await searchText("greetUser", makeScope(dir), { context: 1 });

    expect(result.matches.length).toBeGreaterThan(0);
    const match = result.matches[0];
    // context lines should surround the match
    expect(match.context.length).toBeGreaterThan(0);
    const matchLines = match.context.filter((c) => c.isMatch);
    expect(matchLines.length).toBe(1);
    expect(matchLines[0].line).toBe(match.line);
  });

  it("filters files by glob pattern", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    // Only search main.ts
    const result = await searchText("greetUser", makeScope(dir), { glob: "**/main.ts" });

    expect(result.matches.every((m) => m.file.endsWith("main.ts"))).toBe(true);
    expect(result.matches.some((m) => m.file.endsWith("utils.ts"))).toBe(false);
  });

  it("returns empty matches when pattern is not found", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    const result = await searchText("zzz_does_not_exist_zzz", makeScope(dir));

    expect(result.matches).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it("throws PARSE_ERROR for invalid regex", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    await expect(searchText("[invalid", makeScope(dir))).rejects.toMatchObject({
      code: "PARSE_ERROR",
    });
  });

  it("reports 1-based line and col", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    // utils.ts line 1: "export function greetUser(name: string): string {"
    // "greetUser" starts at col 17
    const result = await searchText("greetUser", makeScope(dir), { glob: "**/utils.ts" });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].line).toBe(1);
    expect(result.matches[0].col).toBe(17);
  });

  it("skips sensitive files", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    // Create a .env file in the fixture that contains the search term
    fs.writeFileSync(path.join(dir, ".env"), "greetUser=secret\n");

    const result = await searchText("greetUser", makeScope(dir));

    // .env should not appear in results
    expect(result.matches.every((m) => !m.file.endsWith(".env"))).toBe(true);
  });

  it("respects maxResults cap and sets truncated=true", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    // "e" appears many times; cap at 2
    const result = await searchText("e", makeScope(dir), { maxResults: 2 });

    expect(result.matches.length).toBeLessThanOrEqual(2);
    expect(result.truncated).toBe(true);
  });

  it("throws REDOS for a catastrophic backtracking pattern", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    await expect(searchText("(a+)+$", makeScope(dir))).rejects.toMatchObject({ code: "REDOS" });
  });

  it("skips binary files (files containing a null byte)", async () => {
    // Exercises the isBinaryContent path: charCodeAt === 0 must return true.
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    const binaryContent = Buffer.concat([
      Buffer.from("greetUser"),
      Buffer.from([0x00]), // null byte marks it as binary
      Buffer.from("more content"),
    ]);
    fs.writeFileSync(path.join(dir, "src/binary.bin"), binaryContent);

    const result = await searchText("greetUser", makeScope(dir));
    expect(result.matches.every((m) => !m.file.endsWith("binary.bin"))).toBe(true);
  });

  it("context lines do not extend before line 1", async () => {
    // Exercises Math.max(0, lineIdx - context): start must be >= 1 even on first line.
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    const result = await searchText("greetUser", makeScope(dir), {
      glob: "**/utils.ts",
      context: 5,
    });

    expect(result.matches).toHaveLength(1);
    const lineNums = result.matches[0].context.map((c) => c.line);
    expect(Math.min(...lineNums)).toBeGreaterThanOrEqual(1);
  });

  it("context lines do not extend past the last line of the file", async () => {
    // Exercises Math.min(lines.length - 1, lineIdx + context): end must not exceed EOF.
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    const content = fs.readFileSync(path.join(dir, "src/utils.ts"), "utf8");
    const totalLines = content.split("\n").length;

    const result = await searchText("greetUser", makeScope(dir), {
      glob: "**/utils.ts",
      context: 100,
    });

    expect(result.matches.length).toBeGreaterThan(0);
    for (const match of result.matches) {
      for (const ctx of match.context) {
        expect(ctx.line).toBeGreaterThanOrEqual(1);
        expect(ctx.line).toBeLessThanOrEqual(totalLines);
      }
    }
  });

  it("searches in a non-git workspace (exercises the walkRecursive fallback)", async () => {
    // Create a bare temp dir with no .git so the git path fails and falls back to walkRecursive.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-search-nogit-"));
    dirs.push(tmpDir);

    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/hello.ts"), "export const greeting = 'hello';\n");

    const result = await searchText("greeting", makeScope(tmpDir));

    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.some((m) => m.file.endsWith("hello.ts"))).toBe(true);
  });

  it("each match reports the correct matchText", async () => {
    // Verifies that m[0] (the actual match) is stored, not a mutated value.
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    const result = await searchText("Hello", makeScope(dir), { glob: "**/utils.ts" });

    expect(result.matches.length).toBeGreaterThan(0);
    for (const match of result.matches) {
      expect(match.matchText).toBe("Hello");
    }
  });
});
