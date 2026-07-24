import { afterEach, describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
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
    }
  });

  test("is a no-op when no daemon is running", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    await expect(stopDaemon(dir)).resolves.toBeUndefined();
    expect(isDaemonAlive(dir)).toBe(false);
  });

  test("sends SIGTERM, waits for daemon to stop, and removes daemon files", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    expect(isDaemonAlive(dir)).toBe(true);
    await stopDaemon(dir);
    expect(isDaemonAlive(dir)).toBe(false);
  }, 15_000);
});
