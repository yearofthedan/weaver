import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(PROJECT_ROOT, ".mcp.json");

interface RpcResponse<T = unknown> {
  id?: number;
  result?: T;
  error?: {
    message?: string;
  };
}

interface McpConfig {
  mcpServers?: {
    "weaver"?: {
      command?: unknown;
      args?: unknown;
    };
  };
}

class JsonRpcLineClient {
  private buffer = "";
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(private readonly proc: ChildProcess) {
    if (!proc.stdout || !proc.stdin) throw new Error("serve process must use piped stdio");

    proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.flush();
    });

    proc.on("exit", (code, signal) => {
      const reason = new Error(`serve exited before response (code=${code}, signal=${signal})`);
      for (const [, waiter] of this.pending) {
        clearTimeout(waiter.timer);
        waiter.reject(reason);
      }
      this.pending.clear();
    });
  }

  private flush(): void {
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;

      let msg: RpcResponse;
      try {
        msg = JSON.parse(line) as RpcResponse;
      } catch {
        continue;
      }
      if (typeof msg.id !== "number") continue;

      const waiter = this.pending.get(msg.id);
      if (!waiter) continue;
      this.pending.delete(msg.id);
      clearTimeout(waiter.timer);

      if (msg.error) {
        waiter.reject(new Error(msg.error.message ?? "JSON-RPC error"));
      } else {
        waiter.resolve(msg.result);
      }
    }
  }

  notify(method: string, params: unknown): void {
    this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  request<T>(method: string, params: unknown, timeoutMs = 15_000): Promise<T> {
    const id = this.nextId++;
    this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out waiting for response: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    });
  }
}

function loadConfig(): { command: string; args: string[] } {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw) as McpConfig;
  const server = parsed.mcpServers?.["weaver"];
  if (!server) throw new Error("Missing mcpServers.weaver in .mcp.json");

  if (typeof server.command !== "string" || server.command.trim().length === 0) {
    throw new Error("mcpServers.weaver.command must be a non-empty string");
  }
  if (server.args !== undefined && !Array.isArray(server.args)) {
    throw new Error("mcpServers.weaver.args must be an array when provided");
  }
  if (Array.isArray(server.args) && !server.args.every((arg) => typeof arg === "string")) {
    throw new Error("mcpServers.weaver.args must contain only strings");
  }

  return { command: server.command, args: Array.isArray(server.args) ? server.args : [] };
}

function waitForReady(proc: ChildProcess, timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!proc.stderr) {
      reject(new Error("serve process is missing stderr"));
      return;
    }

    let buffer = "";
    const timer = setTimeout(() => {
      proc.stderr?.off("data", onData);
      reject(new Error(`timed out waiting for serve ready signal after ${timeoutMs}ms`));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;

        try {
          const msg = JSON.parse(line) as { status?: string; workspace?: string };
          if (msg.status === "ready" && typeof msg.workspace === "string") {
            clearTimeout(timer);
            proc.stderr?.off("data", onData);
            resolve(msg.workspace);
            return;
          }
        } catch {
          // ignore non-JSON stderr lines
        }
      }
    };

    proc.stderr.on("data", onData);
  });
}

function runCommand(
  command: string,
  args: string[],
  opts: { cwd: string; timeoutMs?: number },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const { cwd, timeoutMs = 15_000 } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function stopDaemon(workspace: string): Promise<void> {
  try {
    await runCommand(
      "pnpm",
      ["exec", "tsx", "src/cli.ts", "stop", "--workspace", workspace],
      { cwd: PROJECT_ROOT, timeoutMs: 20_000 },
    );
  } catch {
    // best effort cleanup only
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  process.stdout.write("agent:doctor starting MCP runtime check\n");

  const serve = spawn(config.command, config.args, {
    cwd: PROJECT_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });

  let readyWorkspace = "";
  try {
    readyWorkspace = await waitForReady(serve);
    const client = new JsonRpcLineClient(serve);

    await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "agent-doctor", version: "1.0.0" },
    });
    client.notify("notifications/initialized", {});

    const toolsResult = await client.request<{ tools?: Array<{ name?: string }> }>("tools/list", {});
    const toolNames = new Set((toolsResult.tools ?? []).flatMap((tool) => (tool.name ? [tool.name] : [])));

    process.stdout.write(`agent:doctor ok (workspace=${readyWorkspace})\n`);
    const names = [...toolNames].sort((a, b) => a.localeCompare(b));
    if (names.length === 0) {
      process.stdout.write("agent:doctor warning: tools/list returned no tools\n");
    } else {
      process.stdout.write(`agent:doctor tools: ${names.join(", ")}\n`);
    }
  } finally {
    if (readyWorkspace) await stopDaemon(readyWorkspace);
    if (!serve.killed) serve.kill("SIGTERM");
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`agent:doctor failed: ${message}\n`);
  process.exitCode = 1;
});
