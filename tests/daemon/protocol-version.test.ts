import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../../src/__testHelpers__/helpers.js";
import { isDaemonAlive, PROTOCOL_VERSION, removeDaemonFiles } from "../../src/daemon/daemon";
import { lockfilePath } from "../../src/daemon/paths";
import { callDaemonSocket, killDaemon, spawnAndWaitForReady } from "../../src/__testHelpers__/process-helpers.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const TSX_BIN = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");
const FAKE_DAEMON = path.join(PROJECT_ROOT, "src", "__testHelpers__", "fake-daemon.ts");

function spawnFakeDaemon(workspaceDir: string, version: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      TSX_BIN,
      [FAKE_DAEMON, "--workspace", workspaceDir, "--version", String(version)],
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

describe("protocol version", () => {
  const dirs: string[] = [];
  const procs: ChildProcess[] = [];

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
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    return dir;
  }

  it("ping returns { ok: true, version: PROTOCOL_VERSION }", async () => {
    const dir = await setup();
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    const response = await callDaemonSocket(dir, { method: "ping", params: {} });

    expect(response).toMatchObject({ ok: true, version: PROTOCOL_VERSION });
    expect(typeof response.version).toBe("number");
  });

  it("PROTOCOL_VERSION is a positive integer", () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it("kills and respawns a stale daemon whose ping returns a mismatched version", async () => {
    const dir = await setup();

    // Start a fake daemon that always responds with version -1 (wrong)
    const fakeDaemon = await spawnFakeDaemon(dir, -1);
    procs.push(fakeDaemon);

    const fakePid = (JSON.parse(fs.readFileSync(lockfilePath(dir), "utf8")) as { pid: number }).pid;

    // Serve runs ensureDaemon in the background: detects the wrong version,
    // kills the fake daemon, and spawns a real one.
    const serve = await spawnAndWaitForReady(["serve", "--workspace", dir], { pipeStdin: true });
    procs.push(serve);

    // Poll until the lockfile PID changes — that means the real daemon is up.
    const deadline = Date.now() + 30_000;
    let realPid: number | undefined;
    while (Date.now() < deadline) {
      try {
        const lock = JSON.parse(fs.readFileSync(lockfilePath(dir), "utf8")) as { pid: number };
        if (lock.pid !== fakePid) {
          realPid = lock.pid;
          break;
        }
      } catch {
        // lockfile briefly absent during the transition — keep polling
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(realPid).toBeDefined();
    expect(isDaemonAlive(dir)).toBe(true);
  }, 60_000);
});
