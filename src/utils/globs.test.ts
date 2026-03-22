import { describe, expect, it } from "vitest";
import { globToRegex } from "./globs.js";

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

  it("escapes regex special characters in the pattern", () => {
    const re = globToRegex("src/file.ts");
    // The dot in "file.ts" should be a literal dot, not match any char
    expect(re.test("src/fileXts")).toBe(false);
    expect(re.test("src/file.ts")).toBe(true);
  });

  it("matches a pattern with no wildcards as an exact relative path", () => {
    const re = globToRegex("src/utils");
    expect(re.test("src/utils")).toBe(true);
    expect(re.test("src/utils/other")).toBe(false);
    expect(re.test("lib/src/utils")).toBe(false);
  });
});
