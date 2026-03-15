/**
 * Tests that --workspace defaults to process.cwd() for all three subcommands
 * (daemon, serve, stop) when the flag is omitted.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture } from "../src/__testHelpers__/helpers.js";
import { removeDaemonFiles } from "../src/daemon/daemon.js";
import { killDaemon, runCliCommand, spawnAndWaitForReady } from "./process-helpers.js";

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
      cleanup(dir);
    }
  });

  describe("stop", () => {
    it("accepts no --workspace flag and uses cwd as workspace", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);

      const { exitCode, stdout } = await runCliCommand(["stop"], 10_000, { cwd: dir });

      // Commander exits with non-zero when --workspace was required and missing.
      // After the fix, stop should exit 0 and report stopped:false (no daemon running).
      expect(exitCode).toBe(0);
      expect(stdout).toContain('"stopped":false');
    });

    it("uses cwd workspace to stop a running daemon", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const daemon = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
      procs.push(daemon);

      const { exitCode, stdout } = await runCliCommand(["stop"], 10_000, { cwd: dir });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('"stopped":true');
    }, 15_000);
  });

  describe("daemon", () => {
    it("accepts no --workspace flag and becomes ready using cwd", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);

      const proc = await spawnAndWaitForReady(["daemon"], { cwd: dir });
      procs.push(proc);
      // If spawnAndWaitForReady resolves, the process emitted status:ready
      expect(proc.killed).toBe(false);
    });
  });

  describe("serve", () => {
    it("accepts no --workspace flag and becomes ready using cwd", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);

      const proc = await spawnAndWaitForReady(["serve"], { cwd: dir });
      procs.push(proc);
      expect(proc.killed).toBe(false);
    });
  });

  describe("explicit --workspace still takes precedence over cwd", () => {
    it("stop uses explicit path when provided", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);

      const { exitCode, stdout } = await runCliCommand(["stop", "--workspace", dir]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('"stopped":false');
    });
  });
});
