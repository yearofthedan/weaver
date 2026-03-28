import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const CACHE_DIR = path.join(os.homedir(), ".cache", "weaver");

function workspaceHash(workspaceRoot: string): string {
  return crypto.createHash("sha1").update(workspaceRoot).digest("hex").slice(0, 16);
}

export function socketPath(workspaceRoot: string): string {
  return path.join(CACHE_DIR, `${workspaceHash(workspaceRoot)}.sock`);
}

export function lockfilePath(workspaceRoot: string): string {
  return path.join(CACHE_DIR, `${workspaceHash(workspaceRoot)}.pid`);
}

export function logfilePath(workspaceRoot: string): string {
  return path.join(CACHE_DIR, `${workspaceHash(workspaceRoot)}.log`);
}

export function ensureCacheDir(): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}
