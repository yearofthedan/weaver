/**
 * Unit tests for ensureDaemon — daemon lifecycle management.
 *
 * Uses vi.resetModules() per test to reset the module-level buildVerified
 * flag. External calls are mocked at the module boundary (daemon.ts, build-id.ts,
 * paths.ts,
 * child_process). The callDaemon ping uses a real in-process Unix socket
 * server so the socket protocol is exercised without network I/O.
 */
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import * as tmp from "tmp";
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
}));

/** Build id the CLI side reads from disk. Servers below echo their own. */
const LOCAL_BUILD_ID = 1000;

vi.mock("../../src/daemon/build-id.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./build-id.js")>();
  return { ...actual, CLI_ENTRY: "/fake/cli.js", readBuildId: () => LOCAL_BUILD_ID };
});

vi.mock("../../src/daemon/paths.js", () => ({
  socketPath: (_w: string) => currentSockPath,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: (...args: unknown[]) => mockSpawn(...args) };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WORKSPACE = "/test/workspace";

/** Unix socket server that responds to any request with { status: "success", buildId }. */
function createPingServer(sockPath: string, buildId: number): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer((conn) => {
      let buf = "";
      conn.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        if (buf.includes("\n")) {
          conn.write(`${JSON.stringify({ status: "success", buildId })}\n`);
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
class FakeStderr extends EventEmitter {
  destroy = vi.fn();
}

class FakeChild extends EventEmitter {
  stderr = new FakeStderr();
  unref = vi.fn();
}

function makeFakeChild(opts: { ready?: boolean; exitCode?: number } = { ready: true }) {
  const child = new FakeChild();

  if (opts.exitCode !== undefined) {
    setTimeout(() => child.emit("exit", opts.exitCode), 0);
  } else if (opts.ready !== false) {
    setTimeout(
      () => child.stderr.emit("data", Buffer.from(`${JSON.stringify({ status: "ready" })}\n`)),
      0,
    );
  }
  return child;
}

// ─── Per-test setup / teardown ───────────────────────────────────────────────

let ensureDaemon: (workspace: string) => Promise<void>;
const activeServers: net.Server[] = [];
let tmpDir: tmp.DirResult;

beforeEach(async () => {
  tmpDir = tmp.dirSync({ unsafeCleanup: true });
  currentSockPath = path.join(tmpDir.name, "test.sock");

  mockIsDaemonAlive.mockReset().mockReturnValue(false);
  mockRemoveDaemonFiles.mockReset();
  mockStopDaemon.mockReset().mockResolvedValue(undefined);
  mockSpawn.mockReset();

  // Fresh module instance resets the module-level buildVerified to false.
  vi.resetModules();
  const mod = await import("./ensure-daemon.js");
  ensureDaemon = mod.ensureDaemon;
});

afterEach(async () => {
  for (const server of activeServers.splice(0)) await closeServer(server);
  tmpDir.removeCallback();
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ensureDaemon", () => {
  describe("stale socket", () => {
    it("removes stale files and spawns when socket exists but process is dead", async () => {
      fs.writeFileSync(currentSockPath, ""); // socket file present on disk
      mockIsDaemonAlive.mockReturnValue(false);
      mockSpawn.mockReturnValue(makeFakeChild({ ready: true }));

      await ensureDaemon(WORKSPACE);

      expect(mockRemoveDaemonFiles).toHaveBeenCalledWith(WORKSPACE);
      expect(mockSpawn).toHaveBeenCalled();
    });

    it("spawns directly without cleanup when no socket file exists", async () => {
      mockIsDaemonAlive.mockReturnValue(false);
      mockSpawn.mockReturnValue(makeFakeChild({ ready: true }));

      await ensureDaemon(WORKSPACE);

      expect(mockRemoveDaemonFiles).not.toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalled();
    });
  });

  describe("live daemon", () => {
    describe("already build-verified this session", () => {
      it("returns immediately without pinging", async () => {
        // First call: no server → connection error → catch sets buildVerified = true
        mockIsDaemonAlive.mockReturnValue(true);
        await ensureDaemon(WORKSPACE);

        // Tripwire: if a second ping were attempted against this wrong-build server,
        // stopDaemon would be called and reveal it.
        const tripwire = await createPingServer(currentSockPath, 99);
        activeServers.push(tripwire);

        await ensureDaemon(WORKSPACE);

        expect(mockStopDaemon).not.toHaveBeenCalled();
        expect(mockSpawn).not.toHaveBeenCalled();
      });
    });

    describe("build matches", () => {
      it("returns without stopping or spawning", async () => {
        const server = await createPingServer(currentSockPath, LOCAL_BUILD_ID);
        activeServers.push(server);
        mockIsDaemonAlive.mockReturnValue(true);

        await ensureDaemon(WORKSPACE);

        expect(mockSpawn).not.toHaveBeenCalled();
        expect(mockStopDaemon).not.toHaveBeenCalled();
        expect(mockRemoveDaemonFiles).not.toHaveBeenCalled();
      });

      it("caches the result so a later call in the same process does not re-ping", async () => {
        const matching = await createPingServer(currentSockPath, LOCAL_BUILD_ID);
        activeServers.push(matching);
        mockIsDaemonAlive.mockReturnValue(true);

        await ensureDaemon(WORKSPACE);
        await closeServer(activeServers.pop() as net.Server);

        // Tripwire: a second ping would now reach a mismatching daemon and
        // trigger stopDaemon. Silence means the cached result was used.
        const mismatching = await createPingServer(currentSockPath, LOCAL_BUILD_ID + 1);
        activeServers.push(mismatching);

        await ensureDaemon(WORKSPACE);

        expect(mockStopDaemon).not.toHaveBeenCalled();
        expect(mockSpawn).not.toHaveBeenCalled();
      });
    });

    describe("build mismatch", () => {
      it("stops the old daemon and spawns a fresh one", async () => {
        const server = await createPingServer(currentSockPath, LOCAL_BUILD_ID + 1);
        activeServers.push(server);
        mockIsDaemonAlive.mockReturnValue(true);
        // mockImplementation so the fake child and its setTimeout(0) are created
        // at spawn() call time, not test-setup time — the async ping would cause
        // a pre-created child's timer to fire before stderr.on("data") is registered.
        mockSpawn.mockImplementation(() => makeFakeChild({ ready: true }));

        await ensureDaemon(WORKSPACE);

        expect(mockStopDaemon).toHaveBeenCalledWith(WORKSPACE);
        expect(mockSpawn).toHaveBeenCalled();
      });
    });

    describe("ping fails unexpectedly", () => {
      it("marks as verified and returns without spawning", async () => {
        // No server at sockPath → ECONNREFUSED / ENOENT → callDaemon rejects
        mockIsDaemonAlive.mockReturnValue(true);

        await ensureDaemon(WORKSPACE); // must resolve, not reject

        expect(mockSpawn).not.toHaveBeenCalled();
        expect(mockStopDaemon).not.toHaveBeenCalled();
      });
    });
  });

  describe("no daemon running", () => {
    it("spawns with daemon command, workspace arg, and detached stdio options", async () => {
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
    });

    it("rejects when the daemon exits before signalling ready", async () => {
      mockIsDaemonAlive.mockReturnValue(false);
      mockSpawn.mockReturnValue(makeFakeChild({ exitCode: 1 }));

      await expect(ensureDaemon(WORKSPACE)).rejects.toThrow(/exited unexpectedly/i);
    });

    it("rejects rather than resolving on a non-ready stderr line before crash", async () => {
      mockIsDaemonAlive.mockReturnValue(false);

      const child = new FakeChild();
      setTimeout(() => {
        child.stderr.emit("data", Buffer.from(`${JSON.stringify({ status: "starting" })}\n`));
        child.emit("exit", 1);
      }, 0);
      mockSpawn.mockImplementation(() => child);

      await expect(ensureDaemon(WORKSPACE)).rejects.toThrow(/exited unexpectedly/i);
    });

    it("detaches the child's stderr pipe and exit listener so the parent can exit", async () => {
      mockIsDaemonAlive.mockReturnValue(false);
      const child = makeFakeChild({ ready: true });
      mockSpawn.mockReturnValue(child);

      await ensureDaemon(WORKSPACE);

      expect(child.stderr.destroy).toHaveBeenCalled();
      expect(child.unref).toHaveBeenCalled();
      expect(child.listenerCount("exit")).toBe(0);
    });

    it("skips ping on the next call after a successful spawn", async () => {
      mockIsDaemonAlive.mockReturnValue(false);
      mockSpawn.mockImplementation(() => makeFakeChild({ ready: true }));
      await ensureDaemon(WORKSPACE);

      // Tripwire: if a ping were attempted, the wrong build would trigger stopDaemon.
      mockIsDaemonAlive.mockReturnValue(true);
      const tripwire = await createPingServer(currentSockPath, 99);
      activeServers.push(tripwire);

      await ensureDaemon(WORKSPACE);

      expect(mockStopDaemon).not.toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalledOnce();
    });
  });
});
