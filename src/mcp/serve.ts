import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { isDaemonAlive, removeDaemonFiles, socketPath } from "../daemon/paths.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI_ENTRY = path.resolve(__dirname, "..", "..", "src", "cli.ts");
const TSX_BIN = path.resolve(__dirname, "..", "..", "node_modules", ".bin", "tsx");

export async function runServe(opts: { workspace: string }): Promise<void> {
  // 1. Resolve workspace to absolute path
  const absWorkspace = path.resolve(opts.workspace);

  // 2. Validate workspace exists and is a directory
  if (!fs.existsSync(absWorkspace)) {
    const error = {
      ok: false,
      error: "VALIDATION_ERROR",
      message: `Workspace directory not found: ${opts.workspace}`,
    };
    process.stdout.write(`${JSON.stringify(error)}\n`);
    process.exit(1);
  }

  if (!fs.statSync(absWorkspace).isDirectory()) {
    const error = {
      ok: false,
      error: "VALIDATION_ERROR",
      message: `Workspace is not a directory: ${opts.workspace}`,
    };
    process.stdout.write(`${JSON.stringify(error)}\n`);
    process.exit(1);
  }

  // 3. Register signal handlers for clean shutdown
  process.on("SIGTERM", () => {
    process.exit(0);
  });

  process.on("SIGINT", () => {
    process.exit(0);
  });

  // 4. Ensure daemon in the background — tool calls that arrive before it is
  //    ready return DAEMON_STARTING, which the caller can retry.
  ensureDaemon(absWorkspace).catch((err) => {
    process.stderr.write(
      `daemon spawn failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });

  // 5. Write readiness signal to stderr
  const readySignal = { status: "ready", workspace: absWorkspace };
  process.stderr.write(`${JSON.stringify(readySignal)}\n`);

  // 6. Start MCP server immediately — takes over stdin/stdout for the JSON-RPC
  //    message loop. Must happen before daemon startup so the MCP initialize
  //    handshake completes within the host's connection timeout.
  await startMcpServer(absWorkspace);
}

/**
 * Ensure a daemon is running for the workspace. If the socket exists but the
 * process is gone (stale), clean it up first. Then auto-spawn if needed and
 * wait for the ready signal.
 */
async function ensureDaemon(absWorkspace: string): Promise<void> {
  const sockPath = socketPath(absWorkspace);

  // If socket file exists but process is dead, remove stale files
  if (fs.existsSync(sockPath) && !isDaemonAlive(absWorkspace)) {
    removeDaemonFiles(absWorkspace);
  }

  // If daemon is already live, nothing to do
  if (isDaemonAlive(absWorkspace)) {
    return;
  }

  // Auto-spawn the daemon as a detached child so it outlives this process
  await spawnDaemon(absWorkspace);
}

async function startMcpServer(absWorkspace: string): Promise<void> {
  const sockPath = socketPath(absWorkspace);
  const server = new McpServer({ name: "light-bridge", version: "0.1.0" });

  server.registerTool(
    "rename",
    {
      description:
        "Rename a symbol at a specific position in a file, updating all references project-wide",
      inputSchema: {
        file: z.string().describe("Absolute path to the file"),
        line: z.number().int().positive().describe("Line number (1-based)"),
        col: z.number().int().positive().describe("Column number (1-based)"),
        newName: z
          .string()
          .regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/, "newName must be a valid identifier")
          .describe("New name for the symbol"),
      },
    },
    async ({ file, line, col, newName }) => {
      try {
        const response = await callDaemon(sockPath, {
          method: "rename",
          params: { file, line, col, newName },
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: false, error: "DAEMON_STARTING", message }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "move",
    {
      description: "Move a file to a new path and update all import references project-wide",
      inputSchema: {
        oldPath: z.string().describe("Absolute path to the file to move"),
        newPath: z.string().describe("Absolute destination path"),
      },
    },
    async ({ oldPath, newPath }) => {
      try {
        const response = await callDaemon(sockPath, {
          method: "move",
          params: { oldPath, newPath },
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: false, error: "DAEMON_STARTING", message }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function callDaemon(sockPath: string, req: object): Promise<object> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(sockPath);
    let buf = "";

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
    const child = spawn(TSX_BIN, [CLI_ENTRY, "daemon", "--workspace", absWorkspace], {
      stdio: ["ignore", "ignore", "pipe"],
      detached: true,
    });

    let stderrBuf = "";

    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for daemon ready signal"));
    }, 30_000);

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      for (const line of stderrBuf.split("\n")) {
        try {
          const msg = JSON.parse(line.trim());
          if (msg.status === "ready") {
            clearTimeout(timer);
            child.unref();
            resolve();
          }
        } catch {
          // not JSON, ignore
        }
      }
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Daemon exited unexpectedly with code ${code}`));
    });
  });
}
