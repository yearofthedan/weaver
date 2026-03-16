import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { walkFiles } from "../../src/utils/file-walk.js";

describe("walkFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-walk-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(relPath: string, content = ""): string {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    return full;
  }

  // ── non-git fallback ──────────────────────────────────────────────────────

  describe("non-git fallback (no .git dir)", () => {
    it("returns empty array when the directory does not exist", () => {
      // Exercises the walkRecursive try/catch path: readdirSync fails → []
      const nonExistent = path.join(tmpDir, "does-not-exist");
      const result = walkFiles(nonExistent, [".ts"]);
      expect(result).toEqual([]);
    });

    it("returns files matching extensions", () => {
      write("a.ts");
      write("b.tsx");
      write("c.vue");
      write("d.js"); // not requested

      const result = walkFiles(tmpDir, [".ts", ".tsx"]);
      const names = result.map((f) => path.basename(f)).sort();
      expect(names).toEqual(["a.ts", "b.tsx"]);
    });

    it("recurses into subdirectories", () => {
      write("src/a.ts");
      write("lib/b.ts");

      const result = walkFiles(tmpDir, [".ts"]);
      expect(result).toHaveLength(2);
    });

    it("skips node_modules", () => {
      write("src/a.ts");
      write("node_modules/dep/index.ts");

      const result = walkFiles(tmpDir, [".ts"]);
      expect(result).toHaveLength(1);
      expect(path.basename(result[0])).toBe("a.ts");
    });

    it("skips dist", () => {
      write("src/a.ts");
      write("dist/bundle.ts");

      const result = walkFiles(tmpDir, [".ts"]);
      expect(result).toHaveLength(1);
      expect(path.basename(result[0])).toBe("a.ts");
    });

    it("skips .git", () => {
      write("src/a.ts");
      write(".git/objects/a.ts");

      const result = walkFiles(tmpDir, [".ts"]);
      expect(result).toHaveLength(1);
    });

    it("skips .nuxt, .output, .vite", () => {
      write("src/a.ts");
      write(".nuxt/a.ts");
      write(".output/a.ts");
      write(".vite/a.ts");

      const result = walkFiles(tmpDir, [".ts"]);
      expect(result).toHaveLength(1);
    });

    it("returns .vue files when requested", () => {
      write("src/Comp.vue");
      write("src/utils.ts");

      const result = walkFiles(tmpDir, [".vue"]);
      expect(result).toHaveLength(1);
      expect(path.basename(result[0])).toBe("Comp.vue");
    });

    it("returns empty array when no matching files", () => {
      write("a.js");
      expect(walkFiles(tmpDir, [".ts"])).toEqual([]);
    });

    it("returns absolute paths", () => {
      write("src/a.ts");
      const result = walkFiles(tmpDir, [".ts"]);
      expect(path.isAbsolute(result[0])).toBe(true);
    });
  });

  // ── git repo ──────────────────────────────────────────────────────────────

  describe("git repo", () => {
    function initGit() {
      execSync("git init", { cwd: tmpDir, stdio: "pipe" });
      execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "pipe" });
      execSync("git config user.name Test", { cwd: tmpDir, stdio: "pipe" });
    }

    it("returns staged .ts files", () => {
      initGit();
      write("src/a.ts");
      execSync("git add .", { cwd: tmpDir, stdio: "pipe" });

      const result = walkFiles(tmpDir, [".ts"]);
      expect(result.map((f) => path.basename(f))).toContain("a.ts");
    });

    it("includes untracked files that are not gitignored", () => {
      initGit();
      write("src/a.ts");
      write("src/b.ts");
      execSync("git add src/a.ts", { cwd: tmpDir, stdio: "pipe" });
      // b.ts is untracked but not ignored — should still appear

      const result = walkFiles(tmpDir, [".ts"]);
      const names = result.map((f) => path.basename(f)).sort();
      expect(names).toContain("a.ts");
      expect(names).toContain("b.ts");
    });

    it("excludes gitignored files", () => {
      initGit();
      write(".gitignore", "dist/\n");
      write("src/a.ts");
      write("dist/b.ts"); // gitignored
      execSync("git add .", { cwd: tmpDir, stdio: "pipe" });

      const result = walkFiles(tmpDir, [".ts"]);
      const names = result.map((f) => path.basename(f));
      expect(names).toContain("a.ts");
      expect(names).not.toContain("b.ts");
    });

    it("returns absolute paths", () => {
      initGit();
      write("src/a.ts");
      execSync("git add .", { cwd: tmpDir, stdio: "pipe" });

      const result = walkFiles(tmpDir, [".ts"]);
      expect(result.length).toBeGreaterThan(0);
      expect(path.isAbsolute(result[0])).toBe(true);
    });

    it("excludes gitignored files in directories not in SKIP_DIRS", () => {
      // "private/" is not in SKIP_DIRS, so the recursive fallback would include it.
      // This test ensures git mode (not the fallback) runs and respects .gitignore.
      initGit();
      write(".gitignore", "private/\n");
      write("src/a.ts");
      write("private/secret.ts");
      execSync("git add .", { cwd: tmpDir, stdio: "pipe" });

      const result = walkFiles(tmpDir, [".ts"]);
      const names = result.map((f) => path.basename(f));
      expect(names).toContain("a.ts");
      expect(names).not.toContain("secret.ts");
    });

    it("excludes files with non-matching extensions in git mode", () => {
      // Exercises the extension filter in the git path:
      // extSet.has(path.extname(line)) must exclude non-requested extensions.
      initGit();
      write("src/a.ts");
      write("src/b.vue"); // added to git but not requested
      execSync("git add .", { cwd: tmpDir, stdio: "pipe" });

      const result = walkFiles(tmpDir, [".ts"]);
      const names = result.map((f) => path.basename(f));
      expect(names).toContain("a.ts");
      expect(names).not.toContain("b.vue");
      expect(result).toHaveLength(1);
    });

    it("excludes git-tracked files deleted from disk", () => {
      // git ls-files --cached returns files that are tracked even if deleted.
      // walkFiles must filter these out to avoid ENOENT when callers read them.
      initGit();
      write("src/a.ts");
      write("src/b.ts");
      execSync("git add .", { cwd: tmpDir, stdio: "pipe" });
      execSync('git commit -m "init"', { cwd: tmpDir, stdio: "pipe" });

      // Delete b.ts from disk but don't stage the deletion
      fs.unlinkSync(path.join(tmpDir, "src/b.ts"));

      const result = walkFiles(tmpDir, [".ts"]);
      const names = result.map((f) => path.basename(f));
      expect(names).toContain("a.ts");
      expect(names).not.toContain("b.ts");
    });
  });
});
