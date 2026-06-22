import type { FileSystem } from "../ports/filesystem.js";

export interface DaemonHost {
  onSignal(signal: "SIGTERM" | "SIGINT", handler: () => void): void;
  exit(code: number): void;
}

export interface DaemonServer {
  listen(path: string): void;
  close(): void;
}

export interface DaemonWatcher {
  stop(): Promise<void>;
}

export interface DaemonLifecycleOpts {
  sockPath: string;
  pidPath: string;
  pid: number;
  fs: FileSystem;
  host: DaemonHost;
  startServer: () => DaemonServer;
  startWatcher: () => DaemonWatcher;
  signalReady: () => void;
  logger?: { cleanup(): void };
}

export async function runLifecycle(opts: DaemonLifecycleOpts): Promise<void> {
  const { sockPath, pidPath, pid, fs, host, startServer, startWatcher, signalReady, logger } = opts;

  let server: DaemonServer | undefined;
  let watcher: DaemonWatcher | undefined;

  function shutdown(): void {
    void watcher?.stop();
    server?.close();
    logger?.cleanup();
    try {
      fs.unlink(sockPath);
    } catch {
      // already gone
    }
    try {
      fs.unlink(pidPath);
    } catch {
      // already gone
    }
    host.exit(0);
  }

  // Handlers are installed before the daemon becomes discoverable so no signal
  // can arrive after the lockfile is written but before cleanup is registered.
  host.onSignal("SIGTERM", shutdown);
  host.onSignal("SIGINT", shutdown);

  fs.writeFile(pidPath, JSON.stringify({ pid, startedAt: Date.now() }));

  server = startServer();
  server.listen(sockPath);

  watcher = startWatcher();

  signalReady();
}
