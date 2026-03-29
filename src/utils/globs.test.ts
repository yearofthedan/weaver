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

  describe("root-level file matching", () => {
    it("**/*.json matches root-level files with no directory segment", () => {
      const re = globToRegex("**/*.json");
      expect(re.test("package.json")).toBe(true);
      expect(re.test("tsconfig.json")).toBe(true);
    });

    it("**/*.json still matches nested files", () => {
      const re = globToRegex("**/*.json");
      expect(re.test("src/foo.json")).toBe(true);
      expect(re.test("a/b/c/foo.json")).toBe(true);
    });

    it("*.json (no slash) matches root-level files via basename heuristic", () => {
      const re = globToRegex("*.json");
      expect(re.test("package.json")).toBe(true);
    });

    it("**/*.ts matches root-level .ts files", () => {
      const re = globToRegex("**/*.ts");
      expect(re.test("index.ts")).toBe(true);
    });

    it("**/*.ts does not match files with wrong extension", () => {
      const re = globToRegex("**/*.ts");
      expect(re.test("index.js")).toBe(false);
    });
  });

  describe("directory-prefixed glob direct children", () => {
    it("eval/**/*.ts matches direct children of eval/", () => {
      const re = globToRegex("eval/**/*.ts");
      expect(re.test("eval/run-eval.ts")).toBe(true);
    });

    it("eval/**/*.ts matches deeply nested files under eval/", () => {
      const re = globToRegex("eval/**/*.ts");
      expect(re.test("eval/cases/foo.ts")).toBe(true);
      expect(re.test("eval/a/b/c.ts")).toBe(true);
    });

    it("eval/**/*.ts does not match files in other directories", () => {
      const re = globToRegex("eval/**/*.ts");
      expect(re.test("src/run-eval.ts")).toBe(false);
    });

    it("src/**/*.ts matches direct children of src/", () => {
      const re = globToRegex("src/**/*.ts");
      expect(re.test("src/foo.ts")).toBe(true);
    });

    it("src/**/*.ts matches deeply nested files", () => {
      const re = globToRegex("src/**/*.ts");
      expect(re.test("src/a/b/foo.ts")).toBe(true);
    });
  });

  describe("adjacent input edge cases", () => {
    it("** alone matches any path", () => {
      const re = globToRegex("**");
      expect(re.test("anything")).toBe(true);
      expect(re.test("a/b/c")).toBe(true);
      expect(re.test("")).toBe(true);
    });

    it("**/foo.ts matches exact basename at any depth", () => {
      const re = globToRegex("**/foo.ts");
      expect(re.test("foo.ts")).toBe(true);
      expect(re.test("src/foo.ts")).toBe(true);
      expect(re.test("a/b/foo.ts")).toBe(true);
      expect(re.test("src/bar.ts")).toBe(false);
    });

    it("src/**/test/**/*.ts handles multiple ** segments", () => {
      const re = globToRegex("src/**/test/**/*.ts");
      expect(re.test("src/test/foo.ts")).toBe(true);
      expect(re.test("src/a/test/foo.ts")).toBe(true);
      expect(re.test("src/a/test/b/foo.ts")).toBe(true);
      expect(re.test("src/a/b/test/c/d/foo.ts")).toBe(true);
    });

    it("**/*.ts matches deeply nested paths", () => {
      const re = globToRegex("**/*.ts");
      expect(re.test("a/b/c/d/e.ts")).toBe(true);
    });

    it("foo/** matches anything under foo including direct children", () => {
      const re = globToRegex("foo/**");
      expect(re.test("foo/bar")).toBe(true);
      expect(re.test("foo/bar/baz")).toBe(true);
    });
  });
});
