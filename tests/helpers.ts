import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";
import { removeDaemonFiles } from "../src/daemon/daemon.js";
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
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [CLI_ENTRY, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
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

/**
 * Parse the JSON result from an MCP tool call response.
 * Extracts the text content and JSON.parses it.
 */
export function parseMcpResult(resp: Record<string, unknown>): Record<string, unknown> {
  const text = (resp.result as { content: { text: string }[] }).content[0].text;
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * Registers afterEach cleanup and returns a `setup` function for MCP integration tests.
 * Call once at the top of a `describe` block; `setup(fixture?)` starts the MCP server
 * for the given fixture and returns `{ dir, client }`.
 */
export function useMcpContext(): {
  setup: (fixture?: string) => Promise<{ dir: string; client: McpTestClient }>;
} {
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

  async function setup(fixture = "simple-ts"): Promise<{ dir: string; client: McpTestClient }> {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    const proc = await spawnAndWaitForReady(["serve", "--workspace", dir], { pipeStdin: true });
    procs.push(proc);
    await waitForDaemon(dir);
    const client = new McpTestClient(proc);
    await client.initialize();
    return { dir, client };
  }

  return { setup };
}
