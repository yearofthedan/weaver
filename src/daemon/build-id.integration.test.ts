import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import {
  BUILT_CLI_ENTRY,
  callDaemonSocket,
  killDaemon,
  runBuiltCliCommand,
  runCliCommand,
  spawnAndWaitForReady,
} from "../__testHelpers__/process-helpers.js";
import { readBuildId } from "./build-id.js";
import { isDaemonAlive, removeDaemonFiles } from "./daemon.js";
import { lockfilePath } from "./paths.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const TSX_BIN = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");
const FAKE_DAEMON = path.join(PROJECT_ROOT, "src", "__testHelpers__", "fake-daemon.ts");

function daemonPid(dir: string): number {
  return (JSON.parse(fs.readFileSync(lockfilePath(dir), "utf8")) as { pid: number }).pid;
}

function spawnFakeDaemon(workspaceDir: string, buildId: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      TSX_BIN,
      [FAKE_DAEMON, "--workspace", workspaceDir, "--build-id", String(buildId)],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    let buf = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Timed out waiting for fake daemon ready signal"));
    }, 15_000);

    // biome-ignore lint/style/noNonNullAssertion: stderr is always available since stdio[2] is "pipe"
    child.stderr!.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      for (const line of buf.split("\n")) {
        try {
          const msg = JSON.parse(line.trim());
          if (msg.status === "ready") {
            clearTimeout(timer);
            resolve(child);
          }
        } catch {
          // not JSON — ignore
        }
      }
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Fake daemon exited early with code ${code}`));
    });
  });
}

describe("daemon build identity", () => {
  const dirs: string[] = [];
  const procs: ChildProcess[] = [];

  afterEach(() => {
    for (const proc of procs.splice(0)) {
      if (!proc.killed) proc.kill();
    }
    for (const dir of dirs.splice(0)) {
      killDaemon(dir);
      removeDaemonFiles(dir);
    }
  });

  test("ping reports the build the daemon is running", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    const response = await callDaemonSocket(dir, { method: "ping", params: {} });

    expect(response).toMatchObject({ status: "success", buildId: readBuildId() });
    expect(typeof response.buildId).toBe("number");
  });

  test("kills and respawns a daemon reporting a different build", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    const fakeDaemon = await spawnFakeDaemon(dir, -1);
    procs.push(fakeDaemon);
    const fakePid = daemonPid(dir);

    // A CLI operation runs ensureDaemon first: it pings the incumbent, sees a
    // build that is not the one on disk, kills it, and spawns a real daemon
    // before issuing the request. (`weaver daemon` would NOT exercise this — it
    // overwrites any incumbent unconditionally without checking.)
    const { exitCode } = await runCliCommand(["get-type-errors", "--workspace", dir, "{}"], 30_000);
    expect(exitCode).toBe(0);

    expect(daemonPid(dir)).not.toBe(fakePid);
    expect(isDaemonAlive(dir)).toBe(true);
  }, 60_000);

  /**
   * The regression case. Runs the built CLI, not src via tsx: a rebuild
   * replaces dist while a live daemon keeps serving the code it already loaded,
   * so the staleness is only observable through the built artifact.
   *
   * Touching the entry file stands in for `pnpm build`, which recreates dist
   * and moves every mtime. The original mtime is restored so a concurrent test
   * file does not see a spurious rebuild.
   */
  test("respawns the daemon after the built CLI is rebuilt", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    const before = await runBuiltCliCommand(["get-type-errors", "--workspace", dir, "{}"]);
    expect(before.exitCode).toBe(0);
    const firstPid = daemonPid(dir);

    const original = fs.statSync(BUILT_CLI_ENTRY);
    try {
      const rebuiltAt = new Date(original.mtimeMs + 5_000);
      fs.utimesSync(BUILT_CLI_ENTRY, rebuiltAt, rebuiltAt);

      const after = await runBuiltCliCommand(["get-type-errors", "--workspace", dir, "{}"]);
      expect(after.exitCode).toBe(0);

      expect(daemonPid(dir)).not.toBe(firstPid);
      expect(isDaemonAlive(dir)).toBe(true);
    } finally {
      fs.utimesSync(BUILT_CLI_ENTRY, original.atime, original.mtime);
    }
  }, 90_000);

  test("reuses the daemon when the build has not changed", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    const first = await runBuiltCliCommand(["get-type-errors", "--workspace", dir, "{}"]);
    expect(first.exitCode).toBe(0);
    const firstPid = daemonPid(dir);

    const second = await runBuiltCliCommand(["get-type-errors", "--workspace", dir, "{}"]);
    expect(second.exitCode).toBe(0);

    expect(daemonPid(dir)).toBe(firstPid);
  }, 90_000);
});
