import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { globToRegex } from "./globs.js";

/**
 * Directories that are never meaningful to an agent when walking or watching
 * a workspace. Used by the file walker and the filesystem watcher.
 */
export const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".nuxt", ".output", ".vite"]);

/**
 * Collect all files under `dir` whose extension is in `extensions`.
 *
 * Strategy:
 * - If `dir` is inside a git repository, delegate to
 *   `git ls-files --cached --others --exclude-standard`. This respects
 *   .gitignore, nested .gitignore, and .git/info/exclude by construction and
 *   requires no skip-list maintenance.
 * - Otherwise (non-git workspace), fall back to a recursive readdir walk that
 *   skips SKIP_DIRS.
 */
export function walkFiles(dir: string, extensions: string[]): string[] {
  const extSet = new Set(extensions);

  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: dir,
    encoding: "utf8",
  });

  if (result.status === 0) {
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .filter((line) => extSet.has(path.extname(line)))
      .map((line) => path.join(dir, line))
      .filter((abs) => fs.existsSync(abs));
  }

  // Fallback for non-git workspaces
  return walkRecursive(dir).filter((f) => extSet.has(path.extname(f)));
}

/**
 * Enumerate all text files in the workspace, optionally filtered by a glob.
 * Uses `git ls-files` when available (respects .gitignore); falls back to a
 * recursive readdir that skips SKIP_DIRS.
 */
export function walkWorkspaceFiles(workspace: string, glob?: string): string[] {
  const globRe = glob ? globToRegex(glob) : null;

  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: workspace,
    encoding: "utf8",
  });

  let files: string[];
  if (result.status === 0) {
    files = result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => path.join(workspace, line));
  } else {
    files = walkRecursive(workspace);
  }

  if (globRe) {
    files = files.filter((f) => {
      const rel = path.relative(workspace, f).split(path.sep).join("/");
      return globRe.test(rel);
    });
  }

  return files;
}

/**
 * Recursively enumerate all files under `dir`, skipping SKIP_DIRS.
 * Returns all files without any extension or glob filtering.
 */
export function walkRecursive(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkRecursive(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}
