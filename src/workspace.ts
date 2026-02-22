import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Returns true if filePath is within (or equal to) workspace.
 * Resolves symlinks for existing paths to prevent symlink escape attacks.
 */
export function isWithinWorkspace(filePath: string, workspace: string): boolean {
  const abs = path.resolve(filePath);
  const rel = path.relative(workspace, abs);
  if (rel.startsWith("..")) return false;
  // For existing paths, also check the real path to catch symlink escapes.
  if (fs.existsSync(abs)) {
    try {
      const real = fs.realpathSync(abs);
      if (path.relative(workspace, real).startsWith("..")) return false;
    } catch {
      return false;
    }
  }
  return true;
}
