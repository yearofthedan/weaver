import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { isDaemonAlive, removeDaemonFiles } from "./daemon/daemon.js";
import { socketPath } from "./daemon/paths.js";
import { validateWorkspace } from "./workspace.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI_ENTRY = path.resolve(__dirname, "..", "src", "cli.ts");
const TSX_BIN = path.resolve(__dirname, "..", "node_modules", ".bin", "tsx");

export async function runServe(opts: { workspace: string }): Promise<void> {
  const validation = validateWorkspace(opts.workspace);
  if (!validation.ok) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: "VALIDATION_ERROR", message: validation.error })}\n`,
    );
    process.exit(1);
  }

  const absWorkspace = validation.workspace;

  process.on("SIGTERM", () => {
    process.exit(0);
  });

  process.on("SIGINT", () => {
    process.exit(0);
  });

  // Spawn daemon in background. Tool calls that arrive before it's ready
  // return DAEMON_STARTING, allowing the caller to retry.
  ensureDaemon(absWorkspace).catch((err) => {
    process.stderr.write(
      `daemon spawn failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });

  const readySignal = { status: "ready", workspace: absWorkspace };
  process.stderr.write(`${JSON.stringify(readySignal)}\n`);

  // Start MCP server immediately. It takes over stdin/stdout for JSON-RPC.
  // Must happen after the ready signal so the MCP initialize handshake
  // completes within the host's connection timeout.
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

// ─── Tool definition table ─────────────────────────────────────────────────

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
}

const TOOLS: ToolDefinition[] = [
  {
    name: "rename",
    description:
      "Rename a symbol at a specific position and update every reference project-wide. " +
      "Use this instead of search-and-replace — it understands scope and won't touch unrelated identifiers with the same name. " +
      "The response lists every file modified; no need to read them to verify. " +
      "If the response contains error DAEMON_STARTING the project graph is still loading — retry the call.",
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
  {
    name: "moveFile",
    description:
      "Move a file to a new path and rewrite every import that references it, project-wide. " +
      "Use this instead of a shell mv followed by manual import fixes. " +
      "The response lists every file modified; no need to read them to verify. " +
      "If the response contains error DAEMON_STARTING the project graph is still loading — retry the call.",
    inputSchema: {
      oldPath: z.string().describe("Absolute path to the file to move"),
      newPath: z.string().describe("Absolute destination path"),
    },
  },
  {
    name: "moveSymbol",
    description:
      "Move a named export from one file to another and update every importer project-wide. " +
      "Use this when reorganising modules — it keeps the symbol's identity intact and rewrites all import paths. " +
      "The destination file is created if it does not already exist. " +
      "The response lists every file modified; no need to read them to verify. " +
      "If the response contains error DAEMON_STARTING the project graph is still loading — retry the call.",
    inputSchema: {
      sourceFile: z.string().describe("Absolute path to the file containing the symbol"),
      symbolName: z
        .string()
        .regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/, "symbolName must be a valid identifier")
        .describe("Name of the exported symbol to move"),
      destFile: z
        .string()
        .describe("Absolute path of the destination file (created if it does not exist)"),
    },
  },
  {
    name: "findReferences",
    description:
      "Find all references to a symbol across the project. " +
      "Use this before a rename or move to understand the blast radius, or to navigate to usages without reading files manually. " +
      "If the response contains error DAEMON_STARTING the project graph is still loading — retry the call.",
    inputSchema: {
      file: z.string().describe("Absolute path to the file"),
      line: z.number().int().positive().describe("Line number (1-based)"),
      col: z.number().int().positive().describe("Column number (1-based)"),
    },
  },
  {
    name: "getDefinition",
    description:
      "Jump to the definition of a symbol at a specific position. " +
      "Use this to navigate to where a symbol is declared before reading or editing it. " +
      "Compiler-verified — avoids grep and works across re-exports, barrel files, and declaration files. " +
      "If the response contains error DAEMON_STARTING the project graph is still loading — retry the call.",
    inputSchema: {
      file: z.string().describe("Absolute path to the file"),
      line: z.number().int().positive().describe("Line number (1-based)"),
      col: z.number().int().positive().describe("Column number (1-based)"),
    },
  },
];

// ─── MCP server ────────────────────────────────────────────────────────────

async function startMcpServer(absWorkspace: string): Promise<void> {
  const sockPath = socketPath(absWorkspace);
  const server = new McpServer({ name: "light-bridge", version: "0.1.0" });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (params) => {
        try {
          const response = await callDaemon(sockPath, {
            method: tool.name,
            params: params as Record<string, unknown>,
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
  }

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
