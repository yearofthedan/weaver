import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect } from "vitest";
import { cleanup, FIXTURES, readFile, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { replaceText } from "./replaceText.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("replaceText operation", () => {
  // ─── Pattern mode ───────────────────────────────────────────────────────

  describe("pattern mode", () => {
    test.override({ fixtureName: FIXTURES.simpleTs.name });

    test("replaces all occurrences across workspace files", async ({ dir }) => {
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

    test("restricts replacement to files matching glob", async ({ dir }) => {
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

    test("supports regex capture groups in replacement", async ({ dir }) => {
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

    test("records unreadable files as skipped", async ({ dir: _dir }) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-replace-skip-"));
      try {
        fs.mkdirSync(path.join(dir, "src"), { recursive: true });
        fs.writeFileSync(path.join(dir, "src/ok.ts"), "export const foo = 'bar';\n");
        const unreadable = path.join(dir, "src/secret.ts");
        fs.writeFileSync(unreadable, "export const foo = 'secret';\n");
        fs.chmodSync(unreadable, 0o000);

        const scope = makeScope(dir);
        await replaceText(scope, { pattern: "foo", replacement: "baz" });

        expect(scope.skipped).toContain(unreadable);

        fs.chmodSync(unreadable, 0o644);
      } finally {
        cleanup(dir);
      }
    });

    test("returns empty result when no files match the pattern", async ({ dir: _dir }) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-tmp-"));
      try {
        const result = await replaceText(makeScope(dir), {
          pattern: "zzz_not_present_zzz",
          replacement: "replaced",
        });

        expect(result.filesModified).toHaveLength(0);
        expect(result.replacementCount).toBe(0);
      } finally {
        cleanup(dir);
      }
    });

    test("throws PARSE_ERROR for invalid regex", async ({ dir: _dir }) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-tmp-"));
      try {
        await expect(
          replaceText(makeScope(dir), { pattern: "[bad", replacement: "x" }),
        ).rejects.toMatchObject({
          code: "PARSE_ERROR",
        });
      } finally {
        cleanup(dir);
      }
    });

    test("throws REDOS for a catastrophic backtracking pattern", async ({ dir: _dir }) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-tmp-"));
      try {
        await expect(
          replaceText(makeScope(dir), { pattern: "(a+)+$", replacement: "x" }),
        ).rejects.toMatchObject({ code: "REDOS" });
      } finally {
        cleanup(dir);
      }
    });

    test("does not modify sensitive files", async ({ dir }) => {
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

    test("rejects paths outside the workspace", async ({ dir: _dir }) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-tmp-"));
      try {
        // edits array with a file outside workspace
        await expect(
          replaceText(makeScope(dir), {
            edits: [{ file: "/etc/passwd", line: 1, col: 1, oldText: "root", newText: "replaced" }],
          }),
        ).rejects.toMatchObject({ code: "WORKSPACE_VIOLATION" });
      } finally {
        cleanup(dir);
      }
    });
  });

  // ─── Surgical mode ──────────────────────────────────────────────────────

  describe("surgical mode", () => {
    test.override({ fixtureName: FIXTURES.simpleTs.name });

    test("applies exact text edits at specified locations", async ({ dir }) => {
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

    test("throws TEXT_MISMATCH when oldText does not match", async ({ dir }) => {
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

    test("applies multiple edits to the same file correctly", async ({ dir }) => {
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

    test("requires either pattern+replacement or edits", async ({ dir: _dir }) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-tmp-"));
      try {
        await expect(replaceText(makeScope(dir), {})).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
        });
      } finally {
        cleanup(dir);
      }
    });
  });
});
