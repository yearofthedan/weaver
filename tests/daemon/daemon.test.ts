import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeDaemonFiles } from "../../src/daemon/daemon";
import { lockfilePath, socketPath } from "../../src/daemon/paths";
import {
  callDaemonSocket,
  cleanup,
  copyFixture,
  killDaemon,
  spawnAndWaitForReady,
} from "../helpers";

const WORKSPACE_FIXTURE = "simple-ts";

describe("daemon command", () => {
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

  it("writes a socket file after becoming ready", async () => {
    const dir = await setup();
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    expect(fs.existsSync(socketPath(dir))).toBe(true);
  });

  it("writes a lockfile containing a live PID", async () => {
    const dir = await setup();
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    // tsx spawns a child process, so proc.pid is the tsx wrapper — not the
    // inner daemon process. Verify the lockfile PID is a live process instead.
    const pid = parseInt(fs.readFileSync(lockfilePath(dir), "utf8").trim(), 10);
    expect(Number.isNaN(pid)).toBe(false);
    expect(() => process.kill(pid, 0)).not.toThrow();
  });

  it("picks up a new source file added out-of-band via the watcher", async () => {
    const dir = await setup();
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    // Add a new file that imports greetUser — outside any daemon operation
    const newFile = path.join(dir, "src", "consumer.ts");
    fs.writeFileSync(
      newFile,
      'import { greetUser } from "./utils";\nexport const msg = greetUser("test");\n',
    );

    // Wait for watcher debounce (200ms) + rebuild margin
    await new Promise((resolve) => setTimeout(resolve, 600));

    // findReferences on greetUser (line 1, col 17 in utils.ts)
    const utilsPath = path.join(dir, "src", "utils.ts");
    const response = await callDaemonSocket(dir, {
      method: "findReferences",
      params: { file: utilsPath, line: 1, col: 17 },
    });

    expect(response.ok).toBe(true);
    const refs = (response as { references: Array<{ file: string }> }).references;
    expect(refs.some((r) => r.file === newFile)).toBe(true);
  });

  it("removes socket and lockfile on SIGTERM", async () => {
    const dir = await setup();
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    await new Promise<void>((resolve) => {
      proc.on("exit", () => resolve());
      proc.kill("SIGTERM");
    });

    expect(fs.existsSync(socketPath(dir))).toBe(false);
    expect(fs.existsSync(lockfilePath(dir))).toBe(false);
  });
});
