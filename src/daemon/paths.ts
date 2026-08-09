import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { FileSystem } from "../ports/filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";

const CACHE_DIR = path.join(os.homedir(), ".cache", "weaver");

/**
 * Filesystem writes go through the injected `FileSystem` port so this module
 * is testable in memory. Callers that legitimately touch real disk rely on
 * this production default.
 */
const defaultFs = new NodeFileSystem();

function workspaceHash(workspaceRoot: string): string {
  let canonical = workspaceRoot;
  try {
    canonical = fs.realpathSync(workspaceRoot);
  } catch {
    // Path doesn't exist yet or filesystem doesn't support symlinks — use as-is.
  }
  return crypto.createHash("sha1").update(canonical).digest("hex").slice(0, 16);
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

export function ensureCacheDir(fs: FileSystem = defaultFs): void {
  fs.mkdir(CACHE_DIR, { recursive: true });
}
