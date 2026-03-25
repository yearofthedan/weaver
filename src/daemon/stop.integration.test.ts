import * as fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../__testHelpers__/helpers.js";
import {
  killDaemon,
  runCliCommand,
  spawnAndWaitForReady,
} from "../__testHelpers__/process-helpers.js";
import { removeDaemonFiles } from "./daemon.js";
import { lockfilePath, socketPath } from "./paths.js";

const WORKSPACE_FIXTURE = FIXTURES.simpleTs.name;

describe("stop command", () => {
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

  async function setup() {
    const dir = copyFixture(WORKSPACE_FIXTURE);
    dirs.push(dir);
    return dir;
  }

  it("stops a running daemon, exits 0, and removes socket + lockfile", async () => {
    const dir = await setup();
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    // 20s timeout: stop internally polls up to 5s after SIGTERM, plus socket
    // ping overhead — the default 10s is too tight in slow environments.
    const result = await runCliCommand(["stop", "--workspace", dir], 20_000);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ status: "success", stopped: true });
    expect(fs.existsSync(socketPath(dir))).toBe(false);
    expect(fs.existsSync(lockfilePath(dir))).toBe(false);
  });

  it("exits 0 with stopped:false when no daemon is running", async () => {
    const dir = await setup();

    const result = await runCliCommand(["stop", "--workspace", dir]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ status: "success", stopped: false });
  });
});
