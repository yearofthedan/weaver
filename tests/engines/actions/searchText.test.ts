import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { searchText } from "../../../src/operations/searchText.js";
import { cleanup, copyFixture } from "../../helpers.js";

describe("searchText operation", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("finds all occurrences of a pattern across workspace files", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);

    const result = await searchText("greetUser", dir);

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
    const dir = copyFixture("simple-ts");
    dirs.push(dir);

    const result = await searchText("greetUser", dir, { context: 1 });

    expect(result.matches.length).toBeGreaterThan(0);
    const match = result.matches[0];
    // context lines should surround the match
    expect(match.context.length).toBeGreaterThan(0);
    const matchLines = match.context.filter((c) => c.isMatch);
    expect(matchLines.length).toBe(1);
    expect(matchLines[0].line).toBe(match.line);
  });

  it("filters files by glob pattern", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);

    // Only search main.ts
    const result = await searchText("greetUser", dir, { glob: "**/main.ts" });

    expect(result.matches.every((m) => m.file.endsWith("main.ts"))).toBe(true);
    expect(result.matches.some((m) => m.file.endsWith("utils.ts"))).toBe(false);
  });

  it("returns empty matches when pattern is not found", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);

    const result = await searchText("zzz_does_not_exist_zzz", dir);

    expect(result.matches).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it("throws PARSE_ERROR for invalid regex", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);

    await expect(searchText("[invalid", dir)).rejects.toMatchObject({ code: "PARSE_ERROR" });
  });

  it("reports 1-based line and col", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);

    // utils.ts line 1: "export function greetUser(name: string): string {"
    // "greetUser" starts at col 17
    const result = await searchText("greetUser", dir, { glob: "**/utils.ts" });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].line).toBe(1);
    expect(result.matches[0].col).toBe(17);
  });

  it("skips sensitive files", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);

    // Create a .env file in the fixture that contains the search term
    fs.writeFileSync(path.join(dir, ".env"), "greetUser=secret\n");

    const result = await searchText("greetUser", dir);

    // .env should not appear in results
    expect(result.matches.every((m) => !m.file.endsWith(".env"))).toBe(true);
  });

  it("respects maxResults cap and sets truncated=true", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);

    // "e" appears many times; cap at 2
    const result = await searchText("e", dir, { maxResults: 2 });

    expect(result.matches.length).toBeLessThanOrEqual(2);
    expect(result.truncated).toBe(true);
  });
});
