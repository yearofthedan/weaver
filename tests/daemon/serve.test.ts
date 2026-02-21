import * as fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { isDaemonAlive, lockfilePath, removeDaemonFiles, socketPath } from "../../src/daemon/paths";
import { cleanup, copyFixture, spawnAndWaitForReady } from "../helpers";

describe("serve command — daemon integration", () => {
  const dirs: string[] = [];
  const procs: import("node:child_process").ChildProcess[] = [];

  afterEach(() => {
    for (const proc of procs.splice(0)) {
      if (!proc.killed) proc.kill();
    }
    for (const dir of dirs.splice(0)) {
      removeDaemonFiles(dir);
      cleanup(dir);
    }
  });

  async function setup() {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    return dir;
  }

  it("auto-spawns a daemon and becomes ready", async () => {
    const dir = await setup();
    const proc = await spawnAndWaitForReady(["serve", "--workspace", dir]);
    procs.push(proc);

    expect(fs.existsSync(socketPath(dir))).toBe(true);
    expect(isDaemonAlive(dir)).toBe(true);
  });

  it("connects to an already-running daemon without spawning a second one", async () => {
    const dir = await setup();

    // Start the daemon explicitly first
    const daemon = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(daemon);
    const firstPid = parseInt(fs.readFileSync(lockfilePath(dir), "utf8").trim(), 10);

    // Now start serve — it should reuse the existing daemon
    const serve = await spawnAndWaitForReady(["serve", "--workspace", dir]);
    procs.push(serve);
    const secondPid = parseInt(fs.readFileSync(lockfilePath(dir), "utf8").trim(), 10);

    expect(secondPid).toBe(firstPid);
  });

  it("recovers from a stale socket and spawns a new daemon", async () => {
    const dir = await setup();

    // Write a stale socket and lockfile with a dead PID
    fs.mkdirSync(require("node:path").dirname(socketPath(dir)), { recursive: true });
    fs.writeFileSync(socketPath(dir), "");
    fs.writeFileSync(lockfilePath(dir), "999999999");

    const proc = await spawnAndWaitForReady(["serve", "--workspace", dir]);
    procs.push(proc);

    expect(fs.existsSync(socketPath(dir))).toBe(true);
    expect(isDaemonAlive(dir)).toBe(true);
  });
});
