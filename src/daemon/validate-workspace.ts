import * as os from "node:os";
import * as path from "node:path";
import type { FileSystem } from "../ports/filesystem.js";

const RESTRICTED_WORKSPACE_ROOT_BASES: readonly string[] = [
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/proc",
  "/root",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
  path.join(os.homedir(), ".aws"),
  path.join(os.homedir(), ".azure"),
  path.join(os.homedir(), ".gnupg"),
  path.join(os.homedir(), ".kube"),
  path.join(os.homedir(), ".ssh"),
];

function buildRestrictedSet(fs: FileSystem): ReadonlySet<string> {
  return new Set(
    RESTRICTED_WORKSPACE_ROOT_BASES.flatMap((p) => {
      try {
        const real = fs.realpath(p);
        return real === p ? [p] : [p, real];
      } catch {
        return [p];
      }
    }),
  );
}

export function validateWorkspace(
  workspacePath: string,
  fs: FileSystem,
): { ok: true; workspace: string } | { ok: false; error: string } {
  const absWorkspace = path.resolve(workspacePath);

  if (!fs.exists(absWorkspace)) {
    return { ok: false, error: `Workspace directory not found: ${workspacePath}` };
  }

  if (!fs.stat(absWorkspace).isDirectory()) {
    return { ok: false, error: `Workspace is not a directory: ${workspacePath}` };
  }

  const restricted = buildRestrictedSet(fs);

  if (restricted.has(absWorkspace)) {
    return { ok: false, error: `Workspace is a restricted system path: ${workspacePath}` };
  }

  try {
    const real = fs.realpath(absWorkspace);
    if (restricted.has(real)) {
      return {
        ok: false,
        error: `Workspace resolves to a restricted system path: ${workspacePath}`,
      };
    }
  } catch {
    return { ok: false, error: `Could not resolve workspace path: ${workspacePath}` };
  }

  return { ok: true, workspace: absWorkspace };
}
