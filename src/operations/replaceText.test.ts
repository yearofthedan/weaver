import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect } from "vitest";
import { FIXTURES, readFile, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { makeThrowingScope } from "../ports/__testHelpers__/throwing-filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { replaceText } from "./replaceText.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("replaceText operation", () => {
  // ─── Pattern mode ───────────────────────────────────────────────────────

  describe("pattern mode", () => {
    test("replaces all occurrences across workspace files", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const before = readFile(dir, "src/utils.ts");
      expect(before).toContain("greetUser");

      const result = await replaceText(makeScope(dir), {
        pattern: "greetUser",
        replacement: "welcomeUser",
      });

      expect(result.replacementCount).toBeGreaterThanOrEqual(2);
      expect(result.filesModified.length).toBeGreaterThanOrEqual(2);

      const utilsAfter = readFile(dir, "src/utils.ts");
      expect(utilsAfter).toContain("welcomeUser");
      expect(utilsAfter).not.toContain("greetUser");

      const mainAfter = readFile(dir, "src/main.ts");
      expect(mainAfter).toContain("welcomeUser");
      expect(mainAfter).not.toContain("greetUser");
    });

    test("restricts replacement to files matching glob", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const result = await replaceText(makeScope(dir), {
        pattern: "greetUser",
        replacement: "welcomeUser",
        glob: "**/utils.ts",
      });

      expect(result.filesModified).toHaveLength(1);
      expect(result.filesModified[0]).toContain("utils.ts");

      // main.ts should be untouched
      const mainAfter = readFile(dir, "src/main.ts");
      expect(mainAfter).toContain("greetUser");
    });

    test("supports regex capture groups in replacement", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      // Wrap "greetUser" in parens → "GREET(greetUser)"
      const result = await replaceText(makeScope(dir), {
        pattern: "(greetUser)",
        replacement: "GREET($1)",
        glob: "**/utils.ts",
      });

      expect(result.replacementCount).toBeGreaterThan(0);
      const after = readFile(dir, "src/utils.ts");
      expect(after).toContain("GREET(greetUser)");
    });

    test("records unreadable files as skipped", async ({ seedInlineFixture }) => {
      const dir = await seedInlineFixture({
        "src/ok.ts": "export const foo = 'bar';\n",
        "src/secret.ts": "export const foo = 'secret';\n",
      });
      const unreadable = path.join(dir, "src/secret.ts");
      const scope = makeThrowingScope(dir, unreadable);
      await replaceText(scope, { pattern: "foo", replacement: "baz" });

      expect(scope.skipped).toContain(unreadable);
    });

    test("returns empty result when no files match the pattern", async ({ dir }) => {
      const result = await replaceText(makeScope(dir), {
        pattern: "zzz_not_present_zzz",
        replacement: "replaced",
      });

      expect(result.filesModified).toHaveLength(0);
      expect(result.replacementCount).toBe(0);
    });

    test("throws PARSE_ERROR for invalid regex", async ({ dir }) => {
      await expect(
        replaceText(makeScope(dir), { pattern: "[bad", replacement: "x" }),
      ).rejects.toMatchObject({
        code: "PARSE_ERROR",
      });
    });

    test("throws REDOS for a catastrophic backtracking pattern", async ({ dir }) => {
      await expect(
        replaceText(makeScope(dir), { pattern: "(a+)+$", replacement: "x" }),
      ).rejects.toMatchObject({ code: "REDOS" });
    });

    test("throws VALIDATION_ERROR when only pattern is provided without replacement", async ({
      dir,
    }) => {
      await expect(replaceText(makeScope(dir), { pattern: "foo" })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    test("throws VALIDATION_ERROR when only replacement is provided without pattern", async ({
      dir,
    }) => {
      await expect(replaceText(makeScope(dir), { replacement: "bar" })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    test("does not write or count a replacement that leaves the content unchanged", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const result = await replaceText(makeScope(dir), {
        pattern: "greetUser",
        replacement: "greetUser",
      });

      expect(result.filesModified).toHaveLength(0);
      expect(result.replacementCount).toBe(0);
    });

    test("does not modify sensitive files", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const envPath = path.join(dir, ".env");
      fs.writeFileSync(envPath, "greetUser=secret\n");

      const result = await replaceText(makeScope(dir), {
        pattern: "greetUser",
        replacement: "welcomeUser",
      });

      // .env must not appear in filesModified
      expect(result.filesModified.every((f) => !f.endsWith(".env"))).toBe(true);
      // .env content must be unchanged
      expect(fs.readFileSync(envPath, "utf8")).toContain("greetUser");
    });

    test("rejects paths outside the workspace", async ({ dir }) => {
      await expect(
        replaceText(makeScope(dir), {
          edits: [{ file: "/etc/passwd", line: 1, col: 1, oldText: "root", newText: "replaced" }],
        }),
      ).rejects.toMatchObject({ code: "WORKSPACE_VIOLATION" });
    });
  });

  // ─── Surgical mode ──────────────────────────────────────────────────────

  describe("surgical mode", () => {
    test("applies exact text edits at specified locations", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      // utils.ts line 1, col 17: "greetUser"
      const result = await replaceText(makeScope(dir), {
        edits: [
          {
            file: path.join(dir, "src/utils.ts"),
            line: 1,
            col: 17,
            oldText: "greetUser",
            newText: "welcomeUser",
          },
        ],
      });

      expect(result.filesModified).toHaveLength(1);
      expect(result.replacementCount).toBe(1);

      const after = readFile(dir, "src/utils.ts");
      expect(after).toContain("welcomeUser");
    });

    test("throws TEXT_MISMATCH when oldText does not match", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      await expect(
        replaceText(makeScope(dir), {
          edits: [
            {
              file: path.join(dir, "src/utils.ts"),
              line: 1,
              col: 17,
              oldText: "wrongName",
              newText: "whatever",
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "TEXT_MISMATCH" });
    });

    test("applies multiple edits to the same file correctly", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      // utils.ts line 1: "export function greetUser(name: string): string {"
      // "greetUser" at col 17, "name" at col 27, "string" at col 33
      const result = await replaceText(makeScope(dir), {
        edits: [
          {
            file: path.join(dir, "src/utils.ts"),
            line: 1,
            col: 17,
            oldText: "greetUser",
            newText: "hi",
          },
          {
            file: path.join(dir, "src/utils.ts"),
            line: 1,
            col: 27,
            oldText: "name",
            newText: "user",
          },
        ],
      });

      expect(result.replacementCount).toBe(2);
      const after = readFile(dir, "src/utils.ts");
      expect(after).toContain("hi");
      expect(after).toContain("user");
    });

    test("applies edits on different lines in the order that keeps earlier offsets valid", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      // Both edits shrink their line, so an offset computed against the
      // wrong (e.g. ascending) order would land on stale text and fail.
      // utils.ts line 1, col 17: "greetUser" (shrinks by 7 chars)
      // utils.ts line 2, col 11: "Hello" (shrinks by 2 chars)
      const result = await replaceText(makeScope(dir), {
        edits: [
          {
            file: path.join(dir, "src/utils.ts"),
            line: 1,
            col: 17,
            oldText: "greetUser",
            newText: "hi",
          },
          {
            file: path.join(dir, "src/utils.ts"),
            line: 2,
            col: 11,
            oldText: "Hello",
            newText: "Hey",
          },
        ],
      });

      expect(result.replacementCount).toBe(2);
      const after = readFile(dir, "src/utils.ts");
      expect(after).toBe(
        "export function hi(name: string): string {\n  return `Hey, ${name}`;\n}\n",
      );
    });

    test("applies an edit on a later line by accumulating the length of every prior line", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      // utils.ts line 2, col 11: "Hello" — offset must account for line 1's length
      const result = await replaceText(makeScope(dir), {
        edits: [
          {
            file: path.join(dir, "src/utils.ts"),
            line: 2,
            col: 11,
            oldText: "Hello",
            newText: "Howdy",
          },
        ],
      });

      expect(result.replacementCount).toBe(1);
      const after = readFile(dir, "src/utils.ts");
      expect(after).toContain("Howdy");
      expect(after).not.toContain("Hello");
    });

    test("throws TEXT_MISMATCH with an out-of-range message when the line is one past the end of the file", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const outOfRangeLine = readFile(dir, "src/utils.ts").split("\n").length + 1;
      await expect(
        replaceText(makeScope(dir), {
          edits: [
            {
              file: path.join(dir, "src/utils.ts"),
              line: outOfRangeLine,
              col: 1,
              oldText: "greetUser",
              newText: "whatever",
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: "TEXT_MISMATCH",
        message: expect.stringContaining("out of range"),
      });
    });

    test("throws TEXT_MISMATCH with an out-of-range message when the line is zero or negative", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      await expect(
        replaceText(makeScope(dir), {
          edits: [
            {
              file: path.join(dir, "src/utils.ts"),
              line: 0,
              col: 1,
              oldText: "greetUser",
              newText: "whatever",
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: "TEXT_MISMATCH",
        message: expect.stringContaining("out of range"),
      });
    });

    test("rejects edits to sensitive files", async ({ dir }) => {
      const envPath = path.join(dir, ".env");
      fs.writeFileSync(envPath, "KEY=value\n");

      await expect(
        replaceText(makeScope(dir), {
          edits: [{ file: envPath, line: 1, col: 1, oldText: "KEY", newText: "SECRET" }],
        }),
      ).rejects.toMatchObject({ code: "SENSITIVE_FILE" });
    });

    test("throws WORKSPACE_VIOLATION for edits outside workspace", async ({ dir }) => {
      await expect(
        replaceText(makeScope(dir), {
          edits: [{ file: "/etc/passwd", line: 1, col: 1, oldText: "root", newText: "x" }],
        }),
      ).rejects.toMatchObject({ code: "WORKSPACE_VIOLATION" });
    });

    test("requires either pattern+replacement or edits", async ({ dir }) => {
      await expect(replaceText(makeScope(dir), {})).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });
  });

  // ─── Brace glob wiring ──────────────────────────────────────────────────

  describe("brace glob wiring", () => {
    test("brace glob restricts replacements to the expanded file set", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "src/app.ts": "const MARKER = 1;\n",
        "src/app.js": "const MARKER = 2;\n",
        "src/app.vue": "// MARKER\n",
      });

      const result = await replaceText(makeScope(dir), {
        pattern: "MARKER",
        replacement: "REPLACED",
        glob: "**/*.{ts,js}",
      });

      // Only .ts and .js files should be modified
      expect(result.filesModified.every((f) => f.endsWith(".ts") || f.endsWith(".js"))).toBe(true);
      expect(result.filesModified.every((f) => !f.endsWith(".vue"))).toBe(true);
      expect(result.replacementCount).toBe(2);
    });

    test("unsupported glob syntax throws INVALID_GLOB", async ({ seedInlineFixture }) => {
      const dir = await seedInlineFixture({ "src/app.ts": "const x = 1;\n" });

      await expect(
        replaceText(makeScope(dir), { pattern: "x", replacement: "y", glob: "src/[abc].ts" }),
      ).rejects.toMatchObject({ code: "INVALID_GLOB" });
    });
  });

  // ─── excludeGlob ──────────────────────────────────────────────────────────

  describe("excludeGlob", () => {
    test("leaves excluded files untouched while replacing everywhere else", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "docs/archive/old.md": "v1\n",
        "src/a.ts": "v1\n",
      });
      const before = readFile(dir, "docs/archive/old.md");

      const result = await replaceText(makeScope(dir), {
        pattern: "v1",
        replacement: "v2",
        excludeGlob: "docs/archive/**",
      });

      expect(readFile(dir, "docs/archive/old.md")).toBe(before);
      expect(result.filesModified).toEqual([path.join(dir, "src/a.ts")]);
      expect(result.replacementCount).toBe(1);
    });
  });
});
