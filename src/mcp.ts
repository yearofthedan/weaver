import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { isDaemonAlive, PROTOCOL_VERSION, removeDaemonFiles, stopDaemon } from "./daemon/daemon.js";
import { socketPath } from "./daemon/paths.js";
import {
  FindReferencesArgsSchema,
  GetDefinitionArgsSchema,
  MoveArgsSchema,
  MoveSymbolArgsSchema,
  RenameArgsSchema,
  ReplaceTextBaseSchema,
  SearchTextArgsSchema,
  TextEditSchema,
} from "./schema.js";
import { validateWorkspace } from "./security.js";

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
async function ensureDaemon(absWorkspace: string): Promise<void> {
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
      if ((ping as Record<string, unknown>).version !== PROTOCOL_VERSION) {
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
      "When renaming an identifier, use this to update every reference project-wide. " +
      "Scope-aware — won't touch unrelated identifiers that share the same name. " +
      "The response lists every file modified; no need to read them to verify. " +
      "If filesSkipped is non-empty, those files are outside the workspace and were not written — surface this to the user. " +
      "If the response contains error DAEMON_STARTING the project graph is still loading — retry the call.",
    inputSchema: {
      file: RenameArgsSchema.shape.file.describe("Absolute path to the file"),
      line: RenameArgsSchema.shape.line.describe("Line number (1-based)"),
      col: RenameArgsSchema.shape.col.describe("Column number (1-based)"),
      newName: RenameArgsSchema.shape.newName.describe("New name for the symbol"),
    },
  },
  {
    name: "moveFile",
    description:
      "Move a file to a new path. Use this for all file moves — do not use shell mv. " +
      "Rewrites every import that references the file, project-wide, whether or not you expect import changes. " +
      "Also use for non-source files (tests, scripts, config) — creates the destination directory and moves the file even when there are no imports to rewrite. " +
      "The response lists every file modified; no need to read them to verify. " +
      "If filesSkipped is non-empty, those files are outside the workspace and were not written — surface this to the user. " +
      "If the response contains error DAEMON_STARTING the project graph is still loading — retry the call.",
    inputSchema: {
      oldPath: MoveArgsSchema.shape.oldPath.describe("Absolute path to the file to move"),
      newPath: MoveArgsSchema.shape.newPath.describe("Absolute destination path"),
    },
  },
  {
    name: "moveSymbol",
    description:
      "Move a named export from one file to another and update every importer project-wide. " +
      "Use this when reorganising modules — it keeps the symbol's identity intact and rewrites all import paths. " +
      "The destination file is created if it does not already exist. " +
      "Only works on top-level exported declarations (export function, export const, export class, etc.); " +
      "does not support class methods or re-exports via `export { }`. " +
      "The response lists every file modified; no need to read them to verify. " +
      "If filesSkipped is non-empty, those files are outside the workspace and were not written — surface this to the user. " +
      "If the response contains error DAEMON_STARTING the project graph is still loading — retry the call.",
    inputSchema: {
      sourceFile: MoveSymbolArgsSchema.shape.sourceFile.describe(
        "Absolute path to the file containing the symbol",
      ),
      symbolName: MoveSymbolArgsSchema.shape.symbolName.describe(
        "Name of the exported symbol to move",
      ),
      destFile: MoveSymbolArgsSchema.shape.destFile.describe(
        "Absolute path of the destination file (created if it does not exist)",
      ),
    },
  },
  {
    name: "findReferences",
    description:
      "Before modifying, moving, or deleting a symbol, call this to see every file that depends on it. " +
      "This replaces reading files to trace call sites — the compiler already tracks every reference " +
      "through re-exports, barrel files, type-only imports, and Vue SFCs. " +
      "Also use after a change to verify no callers were missed. " +
      "Scope-aware: ignores identically-named symbols in unrelated scopes and string literals that happen to match. " +
      "If the response contains error DAEMON_STARTING the project graph is still loading — retry the call.",
    inputSchema: {
      file: FindReferencesArgsSchema.shape.file.describe("Absolute path to the file"),
      line: FindReferencesArgsSchema.shape.line.describe("Line number (1-based)"),
      col: FindReferencesArgsSchema.shape.col.describe("Column number (1-based)"),
    },
  },
  {
    name: "getDefinition",
    description:
      "When you need to find where a symbol is declared, call this. " +
      "Resolves through re-exports, barrel files, and declaration files " +
      "where text search would find the re-export, not the actual definition. " +
      "If the response contains error DAEMON_STARTING the project graph is still loading — retry the call.",
    inputSchema: {
      file: GetDefinitionArgsSchema.shape.file.describe("Absolute path to the file"),
      line: GetDefinitionArgsSchema.shape.line.describe("Line number (1-based)"),
      col: GetDefinitionArgsSchema.shape.col.describe("Column number (1-based)"),
    },
  },
  {
    name: "searchText",
    description:
      "Search for a regex pattern across all workspace files. " +
      "Results are structured JSON (file, line, col, matchText) that feed directly into replaceText's surgical edit mode. " +
      "Sensitive files (.env, keys, certificates) are never scanned, and the workspace boundary is enforced. " +
      "Use this to discover where a string literal, import path, configuration value, or any text pattern appears before editing it. " +
      "Returns match locations with optional surrounding context lines. " +
      "If truncated is true, results were capped at the internal limit — narrow the search with a more specific pattern or glob.",
    inputSchema: {
      pattern: SearchTextArgsSchema.shape.pattern.describe(
        "ECMAScript regex pattern to search for",
      ),
      glob: SearchTextArgsSchema.shape.glob.describe(
        "Optional glob to restrict which files are searched (e.g. '**/*.ts', 'src/**/*.vue')",
      ),
      context: SearchTextArgsSchema.shape.context.describe(
        "Lines of context before and after each match (like grep -C)",
      ),
      maxResults: SearchTextArgsSchema.shape.maxResults.describe(
        "Cap on total matches returned (default 500)",
      ),
    },
  },
  {
    name: "replaceText",
    description:
      "Replace text across workspace files. Two modes: " +
      "(1) Pattern mode — provide 'pattern' (regex) and 'replacement' to replace all matches across the workspace, " +
      "optionally narrowed by 'glob'. Supports $1, $2, ... backreferences in replacement. " +
      "(2) Surgical mode — provide 'edits' array of {file, line, col, oldText, newText} to replace exact locations; " +
      "oldText is verified before writing, so stale edits are caught. " +
      "Both modes skip sensitive files and enforce the workspace boundary. " +
      "Returns filesModified and replacementCount. " +
      "Use searchText first to locate targets, then replaceText to apply changes.",
    inputSchema: {
      pattern: ReplaceTextBaseSchema.shape.pattern.describe(
        "Regex pattern to replace (pattern mode)",
      ),
      replacement: ReplaceTextBaseSchema.shape.replacement.describe(
        "Replacement string; supports $1, $2, ... backreferences (pattern mode)",
      ),
      glob: ReplaceTextBaseSchema.shape.glob.describe(
        "Optional glob to restrict which files are modified (pattern mode)",
      ),
      edits: z
        .array(
          z.object({
            file: TextEditSchema.shape.file.describe("Absolute path to the file"),
            line: TextEditSchema.shape.line.describe("Line number (1-based)"),
            col: TextEditSchema.shape.col.describe("Column number (1-based)"),
            oldText: TextEditSchema.shape.oldText.describe(
              "Text that must be present at the given position",
            ),
            newText: TextEditSchema.shape.newText.describe("Text to write in place of oldText"),
          }),
        )
        .optional()
        .describe("Surgical edits array (surgical mode)"),
    },
  },
];

// ─── MCP server ────────────────────────────────────────────────────────────

async function startMcpServer(absWorkspace: string): Promise<void> {
  const sockPath = socketPath(absWorkspace);
  const server = new McpServer(
    { name: "light-bridge", version: "0.1.0" },
    {
      instructions:
        "light-bridge provides compiler-aware refactoring tools for JavaScript and TypeScript " +
        "projects (.ts, .tsx, .js, .jsx), with additional support for Vue single-file components (.vue). " +
        "A persistent daemon keeps the project graph in memory — " +
        "tool calls are fast and use far fewer tokens than reading files to trace dependencies manually. " +
        "These tools use the compiler's reference graph, which tracks dependencies through " +
        "re-exports, barrel files, type-only imports, and Vue SFCs that text-based approaches miss.",
    },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (params) => {
        try {
          await ensureDaemon(absWorkspace);
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
                text: JSON.stringify({ ok: false, error: classifyDaemonError(err), message }),
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

function callDaemon(sockPath: string, req: object, timeoutMs = 30_000): Promise<object> {
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

/**
 * Returns "DAEMON_STARTING" for socket-level connection failures and timeouts
 * (transient — the daemon isn't ready yet, caller should retry).
 * Returns "INTERNAL_ERROR" for anything else (don't retry).
 *
 * Exported for testing only — do not call from production code.
 */
export function classifyDaemonError(err: unknown): "DAEMON_STARTING" | "INTERNAL_ERROR" {
  if (!(err instanceof Error)) return "INTERNAL_ERROR";
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ECONNREFUSED" || code === "ENOENT" || code === "ECONNRESET")
    return "DAEMON_STARTING";
  if (err.message.includes("timed out")) return "DAEMON_STARTING";
  return "INTERNAL_ERROR";
}

/** Exported for testing only — do not call from production code. */
export { callDaemon as callDaemonForTest };

function spawnDaemon(absWorkspace: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [CLI_ENTRY, "daemon", "--workspace", absWorkspace], {
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
