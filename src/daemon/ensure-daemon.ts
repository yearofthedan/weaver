import { spawn } from "node:child_process";
import * as net from "node:net";
import type { FileSystem } from "../ports/filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { CLI_ENTRY, isSameBuild, readBuildId } from "./build-id.js";
import { isDaemonAlive, removeDaemonFiles, stopDaemon } from "./daemon.js";
import { socketPath } from "./paths.js";

/**
 * Tracks whether the running daemon has already been confirmed to be running
 * the build on disk. Reset whenever the daemon is known to have stopped so the
 * next ensureDaemon call re-checks the new process.
 *
 * One check per CLI process is enough: a process is short-lived and the build
 * cannot meaningfully change underneath it mid-invocation.
 */
let buildVerified = false;

/**
 * Filesystem reads go through the injected `FileSystem` port so this module
 * is testable in memory. Callers that legitimately touch real disk rely on
 * this production default.
 */
const defaultFs = new NodeFileSystem();

/**
 * Ensure a daemon is running for the workspace. If the socket exists but the
 * process is gone (stale), clean it up first. Then auto-spawn if needed and
 * wait for the ready signal.
 *
 * On first contact with a live daemon its build is checked via `ping`. A
 * daemon running a different build than the one on disk is serving code that
 * has since been replaced — it is killed and a fresh one is spawned.
 */
export async function ensureDaemon(
  absWorkspace: string,
  fs: FileSystem = defaultFs,
): Promise<void> {
  const sockPath = socketPath(absWorkspace);

  // If socket file exists but process is dead, remove stale files
  if (fs.exists(sockPath) && !isDaemonAlive(absWorkspace, fs)) {
    removeDaemonFiles(absWorkspace, fs);
    buildVerified = false;
  }

  if (isDaemonAlive(absWorkspace, fs)) {
    if (buildVerified) return;

    // First contact with this daemon process — check it is running our build.
    try {
      const ping = await callDaemon(sockPath, { method: "ping", params: {} }, 10_000);
      if (isSameBuild(ping.buildId, readBuildId())) {
        buildVerified = true;
        return;
      }
      // Daemon is running a build that is no longer on disk — kill it and
      // fall through to respawn, which sets the flag for the new process.
      await stopDaemon(absWorkspace, { fs });
    } catch {
      // Ping failed unexpectedly; proceed without respawning to preserve
      // existing behaviour for callers that were already mid-flight.
      buildVerified = true;
      return;
    }
  }

  // Auto-spawn the daemon as a detached child so it outlives this process.
  const verbose = process.env.WEAVER_VERBOSE === "1";
  await spawnDaemon(absWorkspace, { verbose });
  buildVerified = true;
}

export function callDaemon(
  sockPath: string,
  req: object,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(sockPath);
    let buf = "";

    socket.setTimeout(timeoutMs);

    socket.on("timeout", () => {
      // destroy() with an error fires the "error" event, which calls reject.
      socket.destroy(new Error(`callDaemon timed out after ${timeoutMs}ms`));
    });

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(req)}\n`);
    });

    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        try {
          resolve(JSON.parse(buf.slice(0, nl)));
        } catch (e) {
          reject(e);
        }
        socket.destroy();
      }
    });

    socket.on("error", reject);
  });
}

function spawnDaemon(absWorkspace: string, opts: { verbose?: boolean } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [CLI_ENTRY, "daemon", "--workspace", absWorkspace];
    if (opts.verbose) args.push("--verbose");
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
      detached: true,
    });

    let stderrBuf = "";
    let consumed = 0;

    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for daemon ready signal"));
    }, 30_000);

    const onExit = (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`Daemon exited unexpectedly with code ${code}`));
    };

    const onData = (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      while (stderrBuf.indexOf("\n", consumed) !== -1) {
        const newline = stderrBuf.indexOf("\n", consumed);
        const line = stderrBuf.slice(consumed, newline).trim();
        consumed = newline + 1;
        try {
          const msg = JSON.parse(line);
          if (msg.status === "ready") {
            clearTimeout(timer);
            child.stderr.off("data", onData);
            child.off("exit", onExit);
            // The piped stderr is a separate handle from the child process;
            // unref() alone leaves it active and hangs the parent's event loop.
            child.stderr.destroy();
            child.unref();
            resolve();
            return;
          }
        } catch {
          // not JSON, ignore
        }
      }
    };

    child.stderr.on("data", onData);
    child.on("exit", onExit);
  });
}
