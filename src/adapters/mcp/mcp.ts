import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { callDaemon, ensureDaemon } from "../../daemon/ensure-daemon.js";
import { socketPath } from "../../daemon/paths.js";
import { validateWorkspace } from "../../domain/security.js";
import { classifyDaemonError } from "./classify-error.js";
import { TOOL_NAMES, TOOLS } from "./tools.js";

export { TOOL_NAMES };

export async function runServe(opts: { workspace: string }): Promise<void> {
  const validation = validateWorkspace(opts.workspace);
  if (!validation.ok) {
    process.stdout.write(
      `${JSON.stringify({ status: "error", error: "VALIDATION_ERROR", message: validation.error })}\n`,
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

// ─── MCP server ────────────────────────────────────────────────────────────

async function startMcpServer(absWorkspace: string): Promise<void> {
  const sockPath = socketPath(absWorkspace);
  const server = new McpServer(
    { name: "weaver", version: "0.1.0" },
    {
      instructions:
        "weaver provides compiler-aware refactoring tools for JavaScript and TypeScript " +
        "projects (.ts, .tsx, .js, .jsx), with additional support for Vue single-file components (.vue). " +
        "A persistent daemon keeps the project graph in memory — " +
        "tool calls are fast and use far fewer tokens than reading files to trace dependencies manually. " +
        "These tools use the compiler's reference graph, which tracks dependencies through " +
        "re-exports, barrel files, type-only imports, and Vue SFCs that text-based approaches miss. " +
        "If any tool returns error DAEMON_STARTING, the project graph is still loading — retry after a short delay.",
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
                text: JSON.stringify({
                  status: "error" as const,
                  error: classifyDaemonError(err),
                  message,
                }),
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
