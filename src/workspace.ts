import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Validate that a workspace path exists and is a directory.
 * Returns `{ ok: true, workspace }` on success, or `{ ok: false, error }` on failure.
 */
export function validateWorkspace(
  workspacePath: string,
): { ok: true; workspace: string } | { ok: false; error: string } {
  const absWorkspace = path.resolve(workspacePath);

  if (!fs.existsSync(absWorkspace)) {
    return { ok: false, error: `Workspace directory not found: ${workspacePath}` };
  }

  if (!fs.statSync(absWorkspace).isDirectory()) {
    return { ok: false, error: `Workspace is not a directory: ${workspacePath}` };
  }

  return { ok: true, workspace: absWorkspace };
}

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
