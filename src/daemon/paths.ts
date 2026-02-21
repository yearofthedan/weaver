import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const CACHE_DIR = path.join(os.homedir(), ".cache", "light-bridge");

function workspaceHash(workspaceRoot: string): string {
  return crypto.createHash("sha1").update(workspaceRoot).digest("hex").slice(0, 16);
}

export function socketPath(workspaceRoot: string): string {
  return path.join(CACHE_DIR, `${workspaceHash(workspaceRoot)}.sock`);
}

export function lockfilePath(workspaceRoot: string): string {
  return path.join(CACHE_DIR, `${workspaceHash(workspaceRoot)}.pid`);
}

export function ensureCacheDir(): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Returns true if the PID in the lockfile corresponds to a running process.
 * Returns false if the lockfile is missing, unparseable, or the process is gone.
 */
export function isDaemonAlive(workspaceRoot: string): boolean {
  const lockfile = lockfilePath(workspaceRoot);
  try {
    const pid = parseInt(fs.readFileSync(lockfile, "utf8").trim(), 10);
    if (Number.isNaN(pid)) return false;
    process.kill(pid, 0); // throws if process doesn't exist
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove the socket and lockfile for a workspace. Used during cleanup and
 * stale socket removal.
 */
export function removeDaemonFiles(workspaceRoot: string): void {
  for (const p of [socketPath(workspaceRoot), lockfilePath(workspaceRoot)]) {
    try {
      fs.unlinkSync(p);
    } catch {
      // already gone
    }
  }
}
