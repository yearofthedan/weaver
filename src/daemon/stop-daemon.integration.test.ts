import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../__testHelpers__/helpers.js";
import { killDaemon, spawnAndWaitForReady } from "../__testHelpers__/process-helpers.js";
import { isDaemonAlive, removeDaemonFiles, stopDaemon } from "./daemon.js";

describe("stopDaemon", () => {
  const dirs: string[] = [];
  const procs: import("node:child_process").ChildProcess[] = [];

  afterEach(() => {
    for (const proc of procs.splice(0)) {
      if (!proc.killed) proc.kill();
    }
    for (const dir of dirs.splice(0)) {
      killDaemon(dir);
      removeDaemonFiles(dir);
      cleanup(dir);
    }
  });

  it("is a no-op when no daemon is running", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    await expect(stopDaemon(dir)).resolves.toBeUndefined();
    expect(isDaemonAlive(dir)).toBe(false);
  });

  it("sends SIGTERM, waits for daemon to stop, and removes daemon files", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    expect(isDaemonAlive(dir)).toBe(true);
    await stopDaemon(dir);
    expect(isDaemonAlive(dir)).toBe(false);
  }, 15_000);
});
