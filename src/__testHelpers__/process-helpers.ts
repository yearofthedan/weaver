import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { lockfilePath, socketPath } from "../daemon/paths.js";
import { PROJECT_ROOT } from "./helpers.js";

const TSX_BIN = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");
const CLI_ENTRY = path.join(PROJECT_ROOT, "src", "adapters", "cli", "cli.ts");

/**
 * Spawn the CLI and wait for a `{ status: "ready" }` line on stderr.
 * Returns the ChildProcess so the caller can kill it in afterEach.
 * Rejects if the ready signal is not received within `timeoutMs`.
 */
export function spawnAndWaitForReady(
  args: string[],
  opts: { timeoutMs?: number; pipeStdin?: boolean; cwd?: string } = {},
): Promise<ChildProcess> {
  const { timeoutMs = 30_000, pipeStdin = false, cwd } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [CLI_ENTRY, ...args], {
      stdio: [pipeStdin ? "pipe" : "ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      ...(cwd ? { cwd } : {}),
    });

    let stderrBuf = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out waiting for ready signal after ${timeoutMs}ms`));
    }, timeoutMs);

    if (!child.stderr) throw new Error("child.stderr is null");
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      for (const line of stderrBuf.split("\n")) {
        try {
          const msg = JSON.parse(line.trim());
          if (msg.status === "ready") {
            clearTimeout(timer);
            resolve(child);
          }
        } catch {
          // not JSON, ignore
        }
      }
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Process exited early with code ${code}`));
    });
  });
}

/**
 * Poll until the daemon socket file exists for the given workspace directory,
 * or reject after timeoutMs. Polls the socket file (created at server.listen)
 * rather than the lockfile PID to avoid a race where the PID is written but
 * the socket is not yet listening.
 */
export function waitForDaemon(dir: string, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const sockPath = socketPath(dir);
    const poll = () => {
      if (fs.existsSync(sockPath)) {
        resolve();
      } else if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for daemon socket after ${timeoutMs}ms`));
      } else {
        setTimeout(poll, 100);
      }
    };
    poll();
  });
}

/**
 * Kill the daemon process for the given workspace directory, if it is running.
 * Reads the PID from the lockfile (JSON format: { pid, startedAt }) and sends
 * SIGTERM. Call this in afterEach before removeDaemonFiles so the daemon
 * process is cleaned up. Note: proc.kill() only kills the tsx wrapper; the
 * inner node process (whose PID is in the lockfile) must be killed separately.
 */
export function killDaemon(dir: string): void {
  const pidPath = lockfilePath(dir);
  try {
    const raw = fs.readFileSync(pidPath, "utf8").trim();
    const parsed = JSON.parse(raw) as unknown;
    const pid =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>).pid
        : undefined;
    if (typeof pid === "number" && !Number.isNaN(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  } catch {
    // lockfile missing or not yet written — nothing to kill
  }
}

/**
 * Send a single JSON request to the daemon socket and return its response.
 * Opens a fresh connection, writes one line, reads one line, then closes.
 */
export function callDaemonSocket(
  dir: string,
  req: { method: string; params: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath(dir));
    let buf = "";

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(req)}\n`);
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

/**
 * Spawn the CLI as a one-shot command and return its captured output.
 * Use this for commands that exit on their own (e.g. `stop`).
 */
export function runCliCommand(
  args: string[],
  timeoutMs = 10_000,
  opts: { cwd?: string } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [CLI_ENTRY, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
