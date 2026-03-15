import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, readFile } from "../../src/__testHelpers__/helpers.js";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { replaceText } from "../../src/operations/replaceText.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("replaceText operation", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = "simple-ts") {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  // ─── Pattern mode ───────────────────────────────────────────────────────

  describe("pattern mode", () => {
    it("replaces all occurrences across workspace files", async () => {
      const dir = setup();

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

    it("restricts replacement to files matching glob", async () => {
      const dir = setup();

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

    it("supports regex capture groups in replacement", async () => {
      const dir = setup();

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

    it("returns empty result when no files match the pattern", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-tmp-"));
      dirs.push(dir);

      const result = await replaceText(makeScope(dir), {
        pattern: "zzz_not_present_zzz",
        replacement: "replaced",
      });

      expect(result.filesModified).toHaveLength(0);
      expect(result.replacementCount).toBe(0);
    });

    it("throws PARSE_ERROR for invalid regex", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-tmp-"));
      dirs.push(dir);

      await expect(
        replaceText(makeScope(dir), { pattern: "[bad", replacement: "x" }),
      ).rejects.toMatchObject({
        code: "PARSE_ERROR",
      });
    });

    it("throws REDOS for a catastrophic backtracking pattern", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-tmp-"));
      dirs.push(dir);

      await expect(
        replaceText(makeScope(dir), { pattern: "(a+)+$", replacement: "x" }),
      ).rejects.toMatchObject({ code: "REDOS" });
    });

    it("does not modify sensitive files", async () => {
      const dir = setup();

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

    it("rejects paths outside the workspace", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-tmp-"));
      dirs.push(dir);

      // edits array with a file outside workspace
      await expect(
        replaceText(makeScope(dir), {
          edits: [{ file: "/etc/passwd", line: 1, col: 1, oldText: "root", newText: "replaced" }],
        }),
      ).rejects.toMatchObject({ code: "WORKSPACE_VIOLATION" });
    });
  });

  // ─── Surgical mode ──────────────────────────────────────────────────────

  describe("surgical mode", () => {
    it("applies exact text edits at specified locations", async () => {
      const dir = setup();

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

    it("throws TEXT_MISMATCH when oldText does not match", async () => {
      const dir = setup();

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

    it("applies multiple edits to the same file correctly", async () => {
      const dir = setup();

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

    it("rejects edits to sensitive files", async () => {
      const dir = setup();

      const envPath = path.join(dir, ".env");
      fs.writeFileSync(envPath, "KEY=value\n");

      await expect(
        replaceText(makeScope(dir), {
          edits: [{ file: envPath, line: 1, col: 1, oldText: "KEY", newText: "SECRET" }],
        }),
      ).rejects.toMatchObject({ code: "SENSITIVE_FILE" });
    });

    it("throws WORKSPACE_VIOLATION for edits outside workspace", async () => {
      const dir = setup();

      await expect(
        replaceText(makeScope(dir), {
          edits: [{ file: "/etc/passwd", line: 1, col: 1, oldText: "root", newText: "x" }],
        }),
      ).rejects.toMatchObject({ code: "WORKSPACE_VIOLATION" });
    });

    it("requires either pattern+replacement or edits", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-tmp-"));
      dirs.push(dir);

      await expect(replaceText(makeScope(dir), {})).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });
  });
});
