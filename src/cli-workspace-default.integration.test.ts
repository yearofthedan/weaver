/**
 * Tests that --workspace defaults to process.cwd() for daemon and stop
 * when the flag is omitted.
 */
import { afterEach, describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "./__testHelpers__/helpers.js";
import {
  killDaemon,
  runCliCommand,
  spawnAndWaitForReady,
} from "./__testHelpers__/process-helpers.js";
import { removeDaemonFiles } from "./daemon/daemon.js";

describe("--workspace default (process.cwd())", () => {
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

  describe("stop", () => {
    test("accepts no --workspace flag and uses cwd as workspace", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);

      const { exitCode, stdout } = await runCliCommand(["stop"], 10_000, { cwd: dir });

      // Commander exits with non-zero when --workspace was required and missing.
      // After the fix, stop should exit 0 and report stopped:false (no daemon running).
      expect(exitCode).toBe(0);
      expect(stdout).toContain('"stopped":false');
    });

    test("uses cwd workspace to stop a running daemon", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const daemon = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
      procs.push(daemon);

      const { exitCode, stdout } = await runCliCommand(["stop"], 10_000, { cwd: dir });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('"stopped":true');
    }, 15_000);
  });

  describe("daemon", () => {
    test("accepts no --workspace flag and becomes ready using cwd", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);

      const proc = await spawnAndWaitForReady(["daemon"], { cwd: dir });
      procs.push(proc);
      // If spawnAndWaitForReady resolves, the process emitted status:ready
      expect(proc.killed).toBe(false);
    });
  });

  describe("explicit --workspace still takes precedence over cwd", () => {
    test("stop uses explicit path when provided", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);

      const { exitCode, stdout } = await runCliCommand(["stop", "--workspace", dir]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('"stopped":false');
    });
  });
});
