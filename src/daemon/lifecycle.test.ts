import { describe, expect, it, vi } from "vitest";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import type { DaemonHost, DaemonServer, DaemonWatcher } from "./lifecycle.js";
import { runLifecycle } from "./lifecycle.js";

function makeFakeHost(): DaemonHost & {
  capturedHandlers: Map<string, () => void>;
  exitCode: number | null;
} {
  const capturedHandlers = new Map<string, () => void>();
  return {
    capturedHandlers,
    exitCode: null,
    onSignal(signal, handler) {
      capturedHandlers.set(signal, handler);
    },
    exit(code) {
      (this as { exitCode: number | null }).exitCode = code;
    },
  };
}

function makeFakeServer(): DaemonServer & { listenedPath: string | null; closed: boolean } {
  return {
    listenedPath: null,
    closed: false,
    listen(p) {
      this.listenedPath = p;
    },
    close() {
      this.closed = true;
    },
  };
}

function makeFakeWatcher(): DaemonWatcher & { stop: ReturnType<typeof vi.fn> } {
  return { stop: vi.fn().mockResolvedValue(undefined) };
}

const SOCK_PATH = "/workspace/.cache/daemon.sock";
const LOCK_PATH = "/workspace/.cache/daemon.pid";

function makeOpts(overrides: Partial<Parameters<typeof runLifecycle>[0]> = {}) {
  return {
    sockPath: SOCK_PATH,
    pidPath: LOCK_PATH,
    pid: 12345,
    ...overrides,
  };
}

describe("daemon lifecycle", () => {
  describe("startup ordering", () => {
    it("installs both signal handlers before the daemon becomes discoverable (lockfile, then server, watcher, ready)", async () => {
      const fs = new InMemoryFileSystem();
      const events: string[] = [];
      const origWrite = fs.writeFile.bind(fs);
      fs.writeFile = (p, c) => {
        events.push("lockfile");
        origWrite(p, c);
      };
      const host: DaemonHost = {
        onSignal: (signal) => {
          events.push(`signal:${signal}`);
        },
        exit: () => {},
      };

      await runLifecycle(
        makeOpts({
          fs,
          host,
          startServer: () => {
            events.push("server");
            return makeFakeServer();
          },
          startWatcher: () => {
            events.push("watcher");
            return makeFakeWatcher();
          },
          signalReady: () => {
            events.push("ready");
          },
        }),
      );

      // The bug this guards against: a SIGTERM can arrive the instant the
      // lockfile exists, so both handlers must already be installed when it is
      // written. Pinning the full order catches a handler registration moved
      // after the write — which no Stryker mutation would surface.
      expect(events).toEqual([
        "signal:SIGTERM",
        "signal:SIGINT",
        "lockfile",
        "server",
        "watcher",
        "ready",
      ]);
    });

    it("writes the lockfile with the given pid and a startedAt timestamp", async () => {
      const fs = new InMemoryFileSystem();

      await runLifecycle(
        makeOpts({
          fs,
          host: makeFakeHost(),
          pid: 99999,
          startServer: () => makeFakeServer(),
          startWatcher: () => makeFakeWatcher(),
          signalReady: () => {},
        }),
      );

      const lock = JSON.parse(fs.readFile(LOCK_PATH)) as { pid: number; startedAt: number };
      expect(lock.pid).toBe(99999);
      expect(typeof lock.startedAt).toBe("number");
      expect(lock.startedAt).toBeGreaterThan(0);
    });

    it("passes the sock path to the server's listen method", async () => {
      const fs = new InMemoryFileSystem();
      const server = makeFakeServer();

      await runLifecycle(
        makeOpts({
          fs,
          host: makeFakeHost(),
          startServer: () => server,
          startWatcher: () => makeFakeWatcher(),
          signalReady: () => {},
        }),
      );

      expect(server.listenedPath).toBe(SOCK_PATH);
    });
  });

  describe("shutdown via SIGTERM", () => {
    it("removes the socket and lockfile and calls exit(0) after full startup", async () => {
      const fs = new InMemoryFileSystem();
      const host = makeFakeHost();

      await runLifecycle(
        makeOpts({
          fs,
          host,
          startServer: () => {
            // Simulate the real server writing the socket file on listen
            const server = makeFakeServer();
            const origListen = server.listen.bind(server);
            server.listen = (p) => {
              fs.writeFile(p, "");
              origListen(p);
            };
            return server;
          },
          startWatcher: () => makeFakeWatcher(),
          signalReady: () => {},
        }),
      );

      expect(fs.exists(LOCK_PATH)).toBe(true);
      expect(fs.exists(SOCK_PATH)).toBe(true);

      const sigtermHandler = host.capturedHandlers.get("SIGTERM");
      expect(sigtermHandler).toBeDefined();
      sigtermHandler?.();
      await new Promise((r) => setTimeout(r, 0));

      expect(fs.exists(SOCK_PATH)).toBe(false);
      expect(fs.exists(LOCK_PATH)).toBe(false);
      expect(host.exitCode).toBe(0);
    });

    it("closes the server on SIGTERM", async () => {
      const fs = new InMemoryFileSystem();
      const host = makeFakeHost();
      const server = makeFakeServer();

      await runLifecycle(
        makeOpts({
          fs,
          host,
          startServer: () => server,
          startWatcher: () => makeFakeWatcher(),
          signalReady: () => {},
        }),
      );

      host.capturedHandlers.get("SIGTERM")?.();
      await new Promise((r) => setTimeout(r, 0));

      expect(server.closed).toBe(true);
    });

    it("stops the watcher on SIGTERM", async () => {
      const fs = new InMemoryFileSystem();
      const host = makeFakeHost();
      const watcher = makeFakeWatcher();

      await runLifecycle(
        makeOpts({
          fs,
          host,
          startServer: () => makeFakeServer(),
          startWatcher: () => watcher,
          signalReady: () => {},
        }),
      );

      host.capturedHandlers.get("SIGTERM")?.();
      await new Promise((r) => setTimeout(r, 0));

      expect(watcher.stop).toHaveBeenCalledOnce();
    });
  });

  describe("shutdown via SIGINT", () => {
    it("removes files and calls exit(0)", async () => {
      const fs = new InMemoryFileSystem();
      const host = makeFakeHost();

      await runLifecycle(
        makeOpts({
          fs,
          host,
          startServer: () => {
            const server = makeFakeServer();
            const origListen = server.listen.bind(server);
            server.listen = (p) => {
              fs.writeFile(p, "");
              origListen(p);
            };
            return server;
          },
          startWatcher: () => makeFakeWatcher(),
          signalReady: () => {},
        }),
      );

      expect(fs.exists(LOCK_PATH)).toBe(true);
      expect(fs.exists(SOCK_PATH)).toBe(true);

      host.capturedHandlers.get("SIGINT")?.();
      await new Promise((r) => setTimeout(r, 0));

      expect(fs.exists(SOCK_PATH)).toBe(false);
      expect(fs.exists(LOCK_PATH)).toBe(false);
      expect(host.exitCode).toBe(0);
    });
  });

  describe("early-stage shutdown (signal before server and watcher are attached)", () => {
    it("removes the lockfile and exits cleanly when the signal fires before the server starts", async () => {
      const fs = new InMemoryFileSystem();
      let exitCode: number | null = null;
      let capturedHandler: (() => void) | undefined;

      const host: DaemonHost = {
        onSignal(signal, handler) {
          if (signal === "SIGTERM") capturedHandler = handler;
        },
        exit(code) {
          exitCode = code;
        },
      };

      let firedEarly = false;
      await runLifecycle(
        makeOpts({
          fs,
          host,
          startServer: () => {
            if (!firedEarly) {
              firedEarly = true;
              capturedHandler?.();
            }
            return makeFakeServer();
          },
          startWatcher: () => makeFakeWatcher(),
          signalReady: () => {},
        }),
      );

      await new Promise((r) => setTimeout(r, 0));

      expect(fs.exists(LOCK_PATH)).toBe(false);
      expect(exitCode).toBe(0);
    });
  });

  describe("logger cleanup", () => {
    it("calls logger.cleanup() on shutdown when a logger is provided", async () => {
      const fs = new InMemoryFileSystem();
      const host = makeFakeHost();
      const logger = { cleanup: vi.fn() };

      await runLifecycle(
        makeOpts({
          fs,
          host,
          startServer: () => makeFakeServer(),
          startWatcher: () => makeFakeWatcher(),
          signalReady: () => {},
          logger,
        }),
      );

      host.capturedHandlers.get("SIGTERM")?.();
      await new Promise((r) => setTimeout(r, 0));

      expect(logger.cleanup).toHaveBeenCalledOnce();
    });

    it("does not throw when no logger is provided", async () => {
      const fs = new InMemoryFileSystem();
      const host = makeFakeHost();

      await expect(
        runLifecycle(
          makeOpts({
            fs,
            host,
            startServer: () => makeFakeServer(),
            startWatcher: () => makeFakeWatcher(),
            signalReady: () => {},
            logger: undefined,
          }),
        ),
      ).resolves.toBeUndefined();
    });
  });
});
