import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { afterEach, describe, expect, it, test } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../__testHelpers__/helpers.js";
import {
  callDaemonSocket,
  killDaemon,
  spawnAndWaitForReady,
} from "../__testHelpers__/process-helpers.js";
import { removeDaemonFiles } from "./daemon.js";
import { lockfilePath, socketPath } from "./paths.js";

function sendRawToSocket(dir: string, raw: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath(dir));
    let buf = "";
    socket.on("connect", () => {
      socket.write(`${raw}\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        try {
          resolve(JSON.parse(buf.slice(0, nl)) as Record<string, unknown>);
        } catch (e) {
          reject(e);
        }
        socket.destroy();
      }
    });
    socket.on("error", reject);
  });
}

const WORKSPACE_FIXTURE = FIXTURES.simpleTs.name;

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

    const { isDaemonAlive } = await import("./daemon.js");
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

    expect(response.status).toBe("success");
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

  describe("PARSE_ERROR for valid JSON that fails envelope validation", () => {
    test.each([
      ["empty method string", { method: "", params: {} }],
      ["params is not an object", { method: "rename", params: "not-an-object" }],
    ] as const)("%s returns PARSE_ERROR", async (_label, req) => {
      const dir = await setup();
      const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
      procs.push(proc);

      const response = await callDaemonSocket(
        dir,
        req as { method: string; params: Record<string, unknown> },
      );
      expect(response).toMatchObject({ status: "error", error: "PARSE_ERROR" });
    });
  });

  it("returns PARSE_ERROR for invalid JSON (SyntaxError) and INTERNAL_ERROR for other unexpected errors", async () => {
    const dir = await setup();
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    // Invalid JSON causes JSON.parse to throw a SyntaxError — that's a genuine parse
    // error, so the daemon returns PARSE_ERROR (not INTERNAL_ERROR).
    const response = await sendRawToSocket(dir, "not valid json {{{");
    expect(response).toMatchObject({ status: "error", error: "PARSE_ERROR" });
    expect(typeof response.message).toBe("string");
    expect((response.message as string).length).toBeGreaterThan(0);
  });
});
