/**
 * Unit tests for ensureDaemon — daemon lifecycle management.
 *
 * Uses vi.resetModules() per test to reset the module-level versionVerified
 * flag. External calls are mocked at the module boundary (daemon.ts, paths.ts,
 * child_process). The callDaemon ping uses a real in-process Unix socket
 * server so the socket protocol is exercised without network I/O.
 */
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mutable stubs referenced by vi.mock factories ──────────────────────────

const mockIsDaemonAlive = vi.fn<() => boolean>();
const mockRemoveDaemonFiles = vi.fn<() => void>();
const mockStopDaemon = vi.fn<() => Promise<void>>();
const mockSpawn = vi.fn();

// socketPath is controlled per-test so servers and the code under test agree.
let currentSockPath = "";

vi.mock("../../src/daemon/daemon.js", () => ({
  isDaemonAlive: (w: string) => mockIsDaemonAlive(w),
  removeDaemonFiles: (w: string) => mockRemoveDaemonFiles(w),
  stopDaemon: (w: string) => mockStopDaemon(w),
  PROTOCOL_VERSION: 1,
}));

vi.mock("../../src/daemon/paths.js", () => ({
  socketPath: (_w: string) => currentSockPath,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: (...args: unknown[]) => mockSpawn(...args) };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WORKSPACE = "/test/workspace";

/** Unix socket server that responds to any request with { ok: true, version }. */
function createPingServer(sockPath: string, version: number): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer((conn) => {
      let buf = "";
      conn.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        if (buf.includes("\n")) {
          conn.write(`${JSON.stringify({ ok: true, version })}\n`);
          conn.end();
        }
      });
    });
    server.listen(sockPath, () => resolve(server));
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Fake child process returned by the mocked spawn.
 * opts.ready=true (default): emits { status: "ready" } on stderr after a tick.
 * opts.exitCode: emits "exit" instead (simulates daemon crash before ready).
 */
function makeFakeChild(opts: { ready?: boolean; exitCode?: number } = { ready: true }) {
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    unref: ReturnType<typeof vi.fn>;
  };
  child.stderr = stderr;
  child.unref = vi.fn();

  if (opts.exitCode !== undefined) {
    setTimeout(() => child.emit("exit", opts.exitCode), 0);
  } else if (opts.ready !== false) {
    setTimeout(
      () => stderr.emit("data", Buffer.from(`${JSON.stringify({ status: "ready" })}\n`)),
      0,
    );
  }
  return child;
}

// ─── Per-test setup / teardown ───────────────────────────────────────────────

let ensureDaemon: (workspace: string) => Promise<void>;
const activeServers: net.Server[] = [];

beforeEach(async () => {
  currentSockPath = path.join(
    os.tmpdir(),
    `ed-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`,
  );

  mockIsDaemonAlive.mockReset().mockReturnValue(false);
  mockRemoveDaemonFiles.mockReset();
  mockStopDaemon.mockReset().mockResolvedValue(undefined);
  mockSpawn.mockReset();

  // Fresh module instance resets the module-level versionVerified to false.
  vi.resetModules();
  const mod = await import("../../src/daemon/ensure-daemon.js");
  ensureDaemon = mod.ensureDaemon;
});

afterEach(async () => {
  for (const server of activeServers.splice(0)) await closeServer(server);
  try {
    fs.unlinkSync(currentSockPath);
  } catch {
    // already gone — fine
  }
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ensureDaemon", () => {
  describe("stale socket cleanup", () => {
    it(
      "given a socket file exists but the process is dead, " +
        "when ensureDaemon is called, " +
        "it removes the stale files and spawns a fresh daemon",
      async () => {
        fs.writeFileSync(currentSockPath, ""); // socket file present on disk
        mockIsDaemonAlive.mockReturnValue(false);
        mockSpawn.mockReturnValue(makeFakeChild({ ready: true }));

        await ensureDaemon(WORKSPACE);

        expect(mockRemoveDaemonFiles).toHaveBeenCalledWith(WORKSPACE);
        expect(mockSpawn).toHaveBeenCalled();
      },
    );

    it(
      "given no socket file on disk and no live daemon, " +
        "when ensureDaemon is called, " +
        "it spawns without calling removeDaemonFiles",
      async () => {
        // existsSync returns false (no file written) so clean path
        mockIsDaemonAlive.mockReturnValue(false);
        mockSpawn.mockReturnValue(makeFakeChild({ ready: true }));

        await ensureDaemon(WORKSPACE);

        expect(mockRemoveDaemonFiles).not.toHaveBeenCalled();
        expect(mockSpawn).toHaveBeenCalled();
      },
    );
  });

  describe("alive daemon — already verified this session", () => {
    it(
      "given versionVerified is already true from a prior call, " +
        "when ensureDaemon is called again, " +
        "it returns without pinging (a mismatched-version server is untouched)",
      async () => {
        // First call: no server → ENOENT → catch block sets versionVerified = true
        mockIsDaemonAlive.mockReturnValue(true);
        await ensureDaemon(WORKSPACE);

        // Create a server that would return a wrong version — if pinged, stopDaemon
        // would be called. The absence of stopDaemon proves no ping was attempted.
        const tripwire = await createPingServer(currentSockPath, 99);
        activeServers.push(tripwire);

        await ensureDaemon(WORKSPACE);

        expect(mockStopDaemon).not.toHaveBeenCalled();
        expect(mockSpawn).not.toHaveBeenCalled();
      },
    );
  });

  describe("alive daemon — version matches", () => {
    it(
      "given a live daemon whose ping returns the current protocol version, " +
        "when ensureDaemon is called, " +
        "it marks the session as verified and returns without spawning",
      async () => {
        const server = await createPingServer(currentSockPath, 1); // PROTOCOL_VERSION = 1
        activeServers.push(server);
        mockIsDaemonAlive.mockReturnValue(true);

        await ensureDaemon(WORKSPACE);

        expect(mockSpawn).not.toHaveBeenCalled();
        expect(mockStopDaemon).not.toHaveBeenCalled();
        expect(mockRemoveDaemonFiles).not.toHaveBeenCalled();
      },
    );
  });

  describe("alive daemon — version mismatch", () => {
    it(
      "given a live daemon with a stale protocol version, " +
        "when ensureDaemon is called, " +
        "it stops the old daemon then spawns a fresh one",
      async () => {
        const server = await createPingServer(currentSockPath, 0); // version 0 ≠ 1
        activeServers.push(server);
        mockIsDaemonAlive.mockReturnValue(true);
        // mockImplementation (not mockReturnValue) so the fake child and its
        // setTimeout(0) are created at spawn() call time, not test-setup time.
        // The async ping means a pre-created child's timer would fire before
        // child.stderr.on("data") is registered.
        mockSpawn.mockImplementation(() => makeFakeChild({ ready: true }));

        await ensureDaemon(WORKSPACE);

        expect(mockStopDaemon).toHaveBeenCalledWith(WORKSPACE);
        expect(mockSpawn).toHaveBeenCalled();
      },
    );
  });

  describe("alive daemon — ping throws unexpectedly", () => {
    it(
      "given the daemon is alive but ping fails with a connection error, " +
        "when ensureDaemon is called, " +
        "it marks the session as verified and returns without spawning (preserves in-flight callers)",
      async () => {
        // No server at sockPath → ECONNREFUSED / ENOENT → callDaemon rejects
        mockIsDaemonAlive.mockReturnValue(true);

        await ensureDaemon(WORKSPACE); // must resolve, not reject

        expect(mockSpawn).not.toHaveBeenCalled();
        expect(mockStopDaemon).not.toHaveBeenCalled();
      },
    );
  });

  describe("daemon not alive — fresh spawn", () => {
    it(
      "given no daemon is running, " +
        "when ensureDaemon is called, " +
        "it spawns the daemon subprocess with the correct workspace argument and detached stdio options",
      async () => {
        mockIsDaemonAlive.mockReturnValue(false);
        mockSpawn.mockReturnValue(makeFakeChild({ ready: true }));

        await ensureDaemon(WORKSPACE);

        expect(mockSpawn).toHaveBeenCalledOnce();
        const [, spawnArgs, spawnOpts] = mockSpawn.mock.calls[0] as [
          string,
          string[],
          Record<string, unknown>,
        ];
        expect(spawnArgs).toContain("daemon");
        expect(spawnArgs).toContain("--workspace");
        expect(spawnArgs).toContain(WORKSPACE);
        expect(spawnOpts).toMatchObject({
          stdio: ["ignore", "ignore", "pipe"],
          detached: true,
        });
      },
    );

    it(
      "given the spawned daemon process exits before signalling ready, " +
        "when ensureDaemon is called, " +
        "it rejects with a descriptive error",
      async () => {
        mockIsDaemonAlive.mockReturnValue(false);
        mockSpawn.mockReturnValue(makeFakeChild({ exitCode: 1 }));

        await expect(ensureDaemon(WORKSPACE)).rejects.toThrow(/exited unexpectedly/i);
      },
    );

    it(
      "given the spawned process emits a non-ready status JSON line then exits, " +
        "when ensureDaemon is called, " +
        "it rejects rather than resolving on the non-ready line",
      async () => {
        mockIsDaemonAlive.mockReturnValue(false);

        const stderr = new EventEmitter();
        const child = new EventEmitter() as EventEmitter & {
          stderr: EventEmitter;
          unref: ReturnType<typeof vi.fn>;
        };
        child.stderr = stderr;
        child.unref = vi.fn();
        setTimeout(() => {
          // Non-ready status line first — must not resolve the promise
          stderr.emit("data", Buffer.from(`${JSON.stringify({ status: "starting" })}\n`));
          // Crash before ever emitting ready
          child.emit("exit", 1);
        }, 0);
        mockSpawn.mockImplementation(() => child);

        await expect(ensureDaemon(WORKSPACE)).rejects.toThrow(/exited unexpectedly/i);
      },
    );

    it(
      "given a daemon was just spawned successfully, " +
        "when ensureDaemon is called again with a live daemon, " +
        "it returns without pinging (versionVerified persists across calls)",
      async () => {
        // Call 1: no live daemon → spawns
        mockIsDaemonAlive.mockReturnValue(false);
        mockSpawn.mockImplementation(() => makeFakeChild({ ready: true }));
        await ensureDaemon(WORKSPACE);

        expect(mockSpawn).toHaveBeenCalledOnce();

        // Call 2: daemon now alive; wrong-version tripwire server — if versionVerified
        // were not set after spawn, a ping would be attempted and stopDaemon called.
        mockIsDaemonAlive.mockReturnValue(true);
        const tripwire = await createPingServer(currentSockPath, 99);
        activeServers.push(tripwire);

        await ensureDaemon(WORKSPACE);

        expect(mockStopDaemon).not.toHaveBeenCalled();
        expect(mockSpawn).toHaveBeenCalledOnce(); // still only one spawn total
      },
    );
  });
});
