import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { searchText } from "./searchText.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("searchText operation", () => {
  let sharedDir: string;
  beforeAll(() => {
    sharedDir = copyFixture(FIXTURES.simpleTs.name);
  });
  afterAll(() => cleanup(sharedDir));

  // Tests that write extra files into the shared dir clean up after themselves
  afterEach(() => {
    const envFile = path.join(sharedDir, ".env");
    if (fs.existsSync(envFile)) fs.rmSync(envFile);
    const binaryFile = path.join(sharedDir, "src/binary.bin");
    if (fs.existsSync(binaryFile)) fs.rmSync(binaryFile);
  });

  it("finds all occurrences of a pattern across workspace files", async () => {
    const result = await searchText("greetUser", makeScope(sharedDir));

    expect(result.truncated).toBe(false);
    expect(result.matches.length).toBeGreaterThanOrEqual(2);

    const files = result.matches.map((m) => m.file);
    expect(files.some((f) => f.endsWith("utils.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("main.ts"))).toBe(true);

    for (const match of result.matches) {
      expect(match.line).toBeGreaterThan(0);
      expect(match.col).toBeGreaterThan(0);
      expect(match.matchText).toBe("greetUser");
      // Default response must have exactly 4 keys — no context or surroundingText
      expect(Object.keys(match)).toEqual(["file", "line", "col", "matchText"]);
      expect("context" in match).toBe(false);
      expect("surroundingText" in match).toBe(false);
    }
  });

  it("returns context lines when requested", async () => {
    const result = await searchText("greetUser", makeScope(sharedDir), { context: 1 });

    expect(result.matches.length).toBeGreaterThan(0);
    const match = result.matches[0];
    // surroundingText should be a non-empty string containing the match line
    expect(typeof match.surroundingText).toBe("string");
    expect(match.surroundingText).toBeTruthy();
    // surroundingText uses \n as line separator (not terminator), so splitting it
    // yields the individual lines (including any blank lines in context)
    const surroundingLines = (match.surroundingText as string).split("\n");
    expect(surroundingLines.length).toBeGreaterThan(0);
    // No double newline at the end — lines are joined without a trailing \n\n
    expect(match.surroundingText).not.toMatch(/\n\n$/);
    // context: 1 gives up to 3 lines (before + match + after); at least 1
    expect(surroundingLines.length).toBeGreaterThanOrEqual(1);
    expect(surroundingLines.length).toBeLessThanOrEqual(3);
    // No context array present
    expect("context" in match).toBe(false);
  });

  it("filters files by glob pattern", async () => {
    // Only search main.ts
    const result = await searchText("greetUser", makeScope(sharedDir), { glob: "**/main.ts" });

    expect(result.matches.every((m) => m.file.endsWith("main.ts"))).toBe(true);
    expect(result.matches.some((m) => m.file.endsWith("utils.ts"))).toBe(false);
  });

  it("returns empty matches when pattern is not found", async () => {
    const result = await searchText("zzz_does_not_exist_zzz", makeScope(sharedDir));

    expect(result.matches).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it("throws PARSE_ERROR for invalid regex", async () => {
    await expect(searchText("[invalid", makeScope(sharedDir))).rejects.toMatchObject({
      code: "PARSE_ERROR",
    });
  });

  it("reports 1-based line and col", async () => {
    // utils.ts line 1: "export function greetUser(name: string): string {"
    // "greetUser" starts at col 17
    const result = await searchText("greetUser", makeScope(sharedDir), { glob: "**/utils.ts" });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].line).toBe(1);
    expect(result.matches[0].col).toBe(17);
  });

  it("skips sensitive files", async () => {
    // Create a .env file in the fixture that contains the search term
    fs.writeFileSync(path.join(sharedDir, ".env"), "greetUser=secret\n");

    const result = await searchText("greetUser", makeScope(sharedDir));

    // .env should not appear in results
    expect(result.matches.every((m) => !m.file.endsWith(".env"))).toBe(true);
  });

  it("respects maxResults cap and sets truncated=true", async () => {
    // "e" appears many times; cap at 2
    const result = await searchText("e", makeScope(sharedDir), { maxResults: 2 });

    expect(result.matches.length).toBeLessThanOrEqual(2);
    expect(result.truncated).toBe(true);
  });

  it("throws REDOS for a catastrophic backtracking pattern", async () => {
    await expect(searchText("(a+)+$", makeScope(sharedDir))).rejects.toMatchObject({
      code: "REDOS",
    });
  });

  it("skips binary files (files containing a null byte)", async () => {
    // Exercises the isBinaryContent path: charCodeAt === 0 must return true.
    const binaryContent = Buffer.concat([
      Buffer.from("greetUser"),
      Buffer.from([0x00]), // null byte marks it as binary
      Buffer.from("more content"),
    ]);
    fs.writeFileSync(path.join(sharedDir, "src/binary.bin"), binaryContent);

    const result = await searchText("greetUser", makeScope(sharedDir));
    expect(result.matches.every((m) => !m.file.endsWith("binary.bin"))).toBe(true);
  });

  it("context lines do not extend before line 1", async () => {
    // Exercises Math.max(0, lineIdx - context): start must be >= 1 even on first line.
    const result = await searchText("greetUser", makeScope(sharedDir), {
      glob: "**/utils.ts",
      context: 5,
    });

    expect(result.matches).toHaveLength(1);
    const surroundingText = result.matches[0].surroundingText as string;
    expect(typeof surroundingText).toBe("string");
    // surroundingText is bounded — cannot have more lines than exist in the file
    const surroundingLines = surroundingText.split("\n");
    expect(surroundingLines.length).toBeGreaterThanOrEqual(1);
    // context: 5 at line 1 → clamped, so we must not have more than min(2*5+1, fileLines)
    const content = fs.readFileSync(path.join(sharedDir, "src/utils.ts"), "utf8");
    const totalLines = content.split("\n").length;
    expect(surroundingLines.length).toBeLessThanOrEqual(Math.min(11, totalLines));
  });

  it("context lines do not extend past the last line of the file", async () => {
    // Exercises Math.min(lines.length - 1, lineIdx + context): end must not exceed EOF.
    const content = fs.readFileSync(path.join(sharedDir, "src/utils.ts"), "utf8");
    const totalLines = content.split("\n").length;

    const result = await searchText("greetUser", makeScope(sharedDir), {
      glob: "**/utils.ts",
      context: 100,
    });

    expect(result.matches.length).toBeGreaterThan(0);
    for (const match of result.matches) {
      const surroundingText = match.surroundingText as string;
      expect(typeof surroundingText).toBe("string");
      const surroundingLines = surroundingText.split("\n");
      // clamped to file size — cannot exceed totalLines
      expect(surroundingLines.length).toBeLessThanOrEqual(totalLines);
      expect(surroundingLines.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("searches in a non-git workspace (exercises the walkRecursive fallback)", async () => {
    // Create a bare temp dir with no .git so the git path fails and falls back to walkRecursive.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-search-nogit-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src/hello.ts"), "export const greeting = 'hello';\n");

      const result = await searchText("greeting", makeScope(tmpDir));

      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches.some((m) => m.file.endsWith("hello.ts"))).toBe(true);
    } finally {
      cleanup(tmpDir);
    }
  });

  it("records unreadable files as skipped", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-search-skip-"));
    try {
      fs.mkdirSync(path.join(dir, "src"), { recursive: true });
      fs.writeFileSync(path.join(dir, "src/ok.ts"), "export const greeting = 'hello';\n");
      const unreadable = path.join(dir, "src/secret.ts");
      fs.writeFileSync(unreadable, "export const greeting = 'secret';\n");
      fs.chmodSync(unreadable, 0o000);

      const scope = makeScope(dir);
      const result = await searchText("greeting", scope);

      expect(result.matches.some((m) => m.file.endsWith("ok.ts"))).toBe(true);
      expect(result.matches.every((m) => !m.file.endsWith("secret.ts"))).toBe(true);
      expect(scope.skipped).toContain(unreadable);

      fs.chmodSync(unreadable, 0o644);
    } finally {
      cleanup(dir);
    }
  });

  it("each match reports the correct matchText", async () => {
    // Verifies that m[0] (the actual match) is stored, not a mutated value.
    const result = await searchText("Hello", makeScope(sharedDir), { glob: "**/utils.ts" });

    expect(result.matches.length).toBeGreaterThan(0);
    for (const match of result.matches) {
      expect(match.matchText).toBe("Hello");
    }
  });

  it("file trailing newline does not produce an extra empty line in results", async () => {
    // Verifies that rawLines stripping removes the trailing empty string from
    // content.split('\n') for files ending with \n, so no phantom match on an
    // empty final line.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-search-trailing-"));
    try {
      fs.mkdirSync(path.join(dir, "src"), { recursive: true });
      // File has exactly 2 real lines plus a trailing newline
      fs.writeFileSync(path.join(dir, "src/two.ts"), "const a = 1;\nconst b = 2;\n");

      // Match something only on line 2; with context 0 we should get exactly 1 match
      const result = await searchText("const b", makeScope(dir));

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].line).toBe(2);
      expect("surroundingText" in result.matches[0]).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  it("surroundingText contains exactly the right window of lines", async () => {
    // Verifies that lines.slice(start, end + 1) correctly limits the window:
    // a 5-line file with a match on line 3 and context 1 should give exactly 3 lines.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-search-window-"));
    try {
      fs.mkdirSync(path.join(dir, "src"), { recursive: true });
      fs.writeFileSync(path.join(dir, "src/five.ts"), "line1\nline2\nMATCH\nline4\nline5\n");

      const result = await searchText("MATCH", makeScope(dir), { context: 1 });

      expect(result.matches).toHaveLength(1);
      const surrounding = result.matches[0].surroundingText as string;
      const surroundingLines = surrounding.split("\n");
      // context 1 around line 3 in a 5-line file → lines 2, 3, 4 = exactly 3
      expect(surroundingLines).toHaveLength(3);
      expect(surroundingLines[0]).toBe("line2");
      expect(surroundingLines[1]).toBe("MATCH");
      expect(surroundingLines[2]).toBe("line4");
    } finally {
      cleanup(dir);
    }
  });

  it("surroundingText is clamped to exact file boundaries (not beyond)", async () => {
    // Exercises Math.min(lines.length - 1, lineIdx + context): with match on last line
    // and context 5, the window must be exactly the available lines, not beyond.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-search-clamp-"));
    try {
      fs.mkdirSync(path.join(dir, "src"), { recursive: true });
      // 3-line file; match on line 3 (last line) with context 5
      fs.writeFileSync(path.join(dir, "src/three.ts"), "line1\nline2\nMATCH\n");

      const result = await searchText("MATCH", makeScope(dir), { context: 5 });

      expect(result.matches).toHaveLength(1);
      const surrounding = result.matches[0].surroundingText as string;
      const surroundingLines = surrounding.split("\n");
      // Only 3 lines exist; clamped to [0..2] so all 3 lines appear
      expect(surroundingLines).toHaveLength(3);
      expect(surroundingLines[2]).toBe("MATCH");
    } finally {
      cleanup(dir);
    }
  });

  it("zero-length match patterns do not cause infinite loops", async () => {
    // Exercises the re.lastIndex++ guard: patterns that match empty strings (like
    // /(?:)/) must advance lastIndex to prevent infinite loops.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-search-zeroLen-"));
    try {
      fs.mkdirSync(path.join(dir, "src"), { recursive: true });
      fs.writeFileSync(path.join(dir, "src/short.ts"), "abc\n");

      // The /(?:)/ pattern matches the empty string at every position
      const result = await searchText("(?:)", makeScope(dir), { maxResults: 10 });

      // Should return up to maxResults matches without hanging, all with empty matchText
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches.every((m) => m.matchText === "")).toBe(true);
    } finally {
      cleanup(dir);
    }
  });
});
