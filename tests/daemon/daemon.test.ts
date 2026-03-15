import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture } from "../../src/__testHelpers__/helpers.js";
import { removeDaemonFiles } from "../../src/daemon/daemon";
import { lockfilePath, socketPath } from "../../src/daemon/paths";
import { callDaemonSocket, killDaemon, spawnAndWaitForReady } from "../process-helpers.js";

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

  it("writes a lockfile containing a live PID and a startedAt timestamp", async () => {
    const dir = await setup();
    const before = Date.now();
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);
    const after = Date.now();

    // tsx spawns a child process, so proc.pid is the tsx wrapper — not the
    // inner daemon process. Verify the lockfile PID is a live process instead.
    const raw = fs.readFileSync(lockfilePath(dir), "utf8");
    const lock = JSON.parse(raw) as { pid: number; startedAt: number };
    expect(Number.isNaN(lock.pid)).toBe(false);
    expect(() => process.kill(lock.pid, 0)).not.toThrow();
    expect(lock.startedAt).toBeGreaterThanOrEqual(before);
    expect(lock.startedAt).toBeLessThanOrEqual(after);
  });

  it("isDaemonAlive returns false when socket file is missing even if lockfile exists", async () => {
    const dir = await setup();
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    // Remove the socket file while the daemon is still running (simulates
    // a PID-recycled scenario: lockfile present, PID alive, but no socket).
    fs.unlinkSync(socketPath(dir));

    const { isDaemonAlive } = await import("../../src/daemon/daemon.js");
    expect(isDaemonAlive(dir)).toBe(false);
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

  it("killDaemon terminates the inner node process", async () => {
    const dir = await setup();
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    const raw = fs.readFileSync(lockfilePath(dir), "utf8");
    const { pid } = JSON.parse(raw) as { pid: number; startedAt: number };
    expect(() => process.kill(pid, 0)).not.toThrow(); // sanity: process is alive

    killDaemon(dir);

    await new Promise((r) => setTimeout(r, 300));

    expect(() => process.kill(pid, 0)).toThrow(); // inner node process is gone
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

  it("returns PARSE_ERROR when the socket receives a malformed envelope (missing method)", async () => {
    const dir = await setup();
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    const response = await callDaemonSocket(dir, { method: "", params: {} });
    expect(response).toMatchObject({ ok: false, error: "PARSE_ERROR" });
  });

  it("returns PARSE_ERROR when params is not an object", async () => {
    const dir = await setup();
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    // callDaemonSocket types params as Record but we force a bad value at runtime
    const response = await callDaemonSocket(dir, {
      method: "rename",
      params: "not-an-object" as unknown as Record<string, unknown>,
    });
    expect(response).toMatchObject({ ok: false, error: "PARSE_ERROR" });
  });
});
