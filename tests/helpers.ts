import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { lockfilePath, socketPath } from "../src/daemon/paths.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const TSX_BIN = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");
const CLI_ENTRY = path.join(PROJECT_ROOT, "src", "cli.ts");

/**
 * Copy a named fixture to a fresh temp directory and return its path.
 * Each test should call this to get an isolated, mutable copy.
 */
export function copyFixture(name: string): string {
  const src = path.join(PROJECT_ROOT, "tests", "fixtures", name);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), `ns-${name}-`));
  copyDirSync(src, dest);
  return dest;
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDirSync(s, d) : fs.copyFileSync(s, d);
  }
}

/** Read a file relative to a fixture temp dir. */
export function readFile(dir: string, relative: string): string {
  return fs.readFileSync(path.join(dir, relative), "utf8");
}

/** Check whether a file exists relative to a fixture temp dir. */
export function fileExists(dir: string, relative: string): boolean {
  return fs.existsSync(path.join(dir, relative));
}

/** Delete a temp dir produced by copyFixture. */
export function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Spawn the CLI and wait for a `{ status: "ready" }` line on stderr.
 * Returns the ChildProcess so the caller can kill it in afterEach.
 * Rejects if the ready signal is not received within `timeoutMs`.
 */
export function spawnAndWaitForReady(
  args: string[],
  opts: { timeoutMs?: number; pipeStdin?: boolean } = {},
): Promise<ChildProcess> {
  const { timeoutMs = 30_000, pipeStdin = false } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [CLI_ENTRY, ...args], {
      stdio: [pipeStdin ? "pipe" : "ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });

    let stderrBuf = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out waiting for ready signal after ${timeoutMs}ms`));
    }, timeoutMs);

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
 * Reads the PID from the lockfile and sends SIGTERM. Call this in afterEach
 * before removeDaemonFiles so the daemon process is cleaned up.
 */
export function killDaemon(dir: string): void {
  const pidPath = lockfilePath(dir);
  try {
    const pid = parseInt(fs.readFileSync(pidPath, "utf8").trim(), 10);
    if (!Number.isNaN(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  } catch {
    // lockfile missing — nothing to kill
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
 * Minimal MCP client for testing. Handles Content-Length framing and the
 * initialize handshake. Use with a process spawned via spawnAndWaitForReady
 * with pipeStdin: true.
 */
export class McpTestClient {
  private buf = "";
  private pending: Array<(msg: Record<string, unknown>) => void> = [];

  constructor(private proc: ChildProcess) {
    // biome-ignore lint/style/noNonNullAssertion: stdout is always piped (spawnAndWaitForReady uses stdio: ['pipe','pipe','pipe'])
    proc.stdout!.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString();
      this.flush();
    });
  }

  private flush(): void {
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl === -1) break;
      const line = this.buf.slice(0, nl).replace(/\r$/, "");
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        // Skip notifications (no id field)
        if ("id" in msg) {
          const resolve = this.pending.shift();
          if (resolve) resolve(msg);
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  send(message: object): void {
    // biome-ignore lint/style/noNonNullAssertion: stdin is always piped when pipeStdin:true is passed to spawnAndWaitForReady
    this.proc.stdin!.write(`${JSON.stringify(message)}\n`);
  }

  receive(): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      this.pending.push(resolve);
      this.flush();
    });
  }

  async request(id: number, method: string, params?: unknown): Promise<Record<string, unknown>> {
    this.send({ jsonrpc: "2.0", id, method, params });
    return this.receive();
  }

  async initialize(): Promise<void> {
    await this.request(0, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    this.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  }
}
