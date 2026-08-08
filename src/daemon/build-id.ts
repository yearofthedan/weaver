import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));

/**
 * The built CLI entry point. The CLI and the daemon it spawns both run from
 * this file, so it is the one artifact whose identity defines "the current
 * build" for either side of the socket.
 */
export const CLI_ENTRY = path.resolve(moduleDir, "../..", "dist", "adapters", "cli", "cli.js");

/**
 * Identity of the build on disk, as the CLI entry's modification time.
 *
 * `pnpm build` runs `rm -rf dist && tsc`, so every build recreates every file
 * and moves this value — including when the only source change was in a module
 * the entry does not contain. Hashing the entry would miss that case, because
 * cli.js comes out byte-identical.
 *
 * Returns null when the entry cannot be read. Callers treat that as a mismatch:
 * a build we cannot identify is not one we can vouch for.
 */
export function readBuildId(): number | null {
  try {
    return fs.statSync(CLI_ENTRY).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Whether a daemon reporting `daemonBuildId` is running the build now on disk.
 *
 * Compared for equality only, never ordering, so clock changes and timezones
 * cannot make a stale daemon look current.
 *
 * Both sides null is not a real-world case: in an install the entry is the
 * running process, so it always stats. It happens when tests run src directly,
 * where it is harmless — neither side has a build to be stale against.
 */
export function isSameBuild(daemonBuildId: unknown, localBuildId: number | null): boolean {
  return daemonBuildId === localBuildId;
}
