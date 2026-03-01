import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { isDaemonAlive, PROTOCOL_VERSION, removeDaemonFiles, stopDaemon } from "./daemon.js";
import { socketPath } from "./paths.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI_ENTRY = path.resolve(__dirname, "../..", "dist", "cli.js");

/**
 * Tracks whether the running daemon's protocol version has already been
 * verified against PROTOCOL_VERSION. Reset whenever the daemon is known to
 * have stopped so the next ensureDaemon call re-verifies the new process.
 */
let versionVerified = false;

/**
 * Ensure a daemon is running for the workspace. If the socket exists but the
 * process is gone (stale), clean it up first. Then auto-spawn if needed and
 * wait for the ready signal.
 *
 * On first contact with a live daemon the protocol version is checked via
 * `ping`. A version mismatch means the daemon is from a prior session and
 * may be missing operations — it is killed and a fresh one is spawned.
 */
export async function ensureDaemon(absWorkspace: string): Promise<void> {
  const sockPath = socketPath(absWorkspace);

  // If socket file exists but process is dead, remove stale files
  if (fs.existsSync(sockPath) && !isDaemonAlive(absWorkspace)) {
    removeDaemonFiles(absWorkspace);
    versionVerified = false;
  }

  if (isDaemonAlive(absWorkspace)) {
    if (versionVerified) return;

    // First contact with this daemon process — verify protocol version.
    try {
      const ping = await callDaemon(sockPath, { method: "ping", params: {} }, 10_000);
      if (ping.version !== PROTOCOL_VERSION) {
        // Stale daemon from a previous session — kill it and fall through to respawn.
        await stopDaemon(absWorkspace);
        versionVerified = false;
      } else {
        versionVerified = true;
        return;
      }
    } catch {
      // Ping failed unexpectedly; proceed without respawning to preserve
      // existing behaviour for callers that were already mid-flight.
      versionVerified = true;
      return;
    }
  }

  // Auto-spawn the daemon as a detached child so it outlives this process.
  await spawnDaemon(absWorkspace);
  versionVerified = true;
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

function spawnDaemon(absWorkspace: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_ENTRY, "daemon", "--workspace", absWorkspace], {
      stdio: ["ignore", "ignore", "pipe"],
      detached: true,
    });

    let stderrBuf = "";
    let consumed = 0;

    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for daemon ready signal"));
    }, 30_000);

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

    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Daemon exited unexpectedly with code ${code}`));
    });
  });
}
