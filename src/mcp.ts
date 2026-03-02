import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callDaemon, ensureDaemon } from "./daemon/ensure-daemon.js";
import { socketPath } from "./daemon/paths.js";
import {
  ExtractFunctionArgsSchema,
  FindReferencesArgsSchema,
  GetDefinitionArgsSchema,
  GetTypeErrorsArgsSchema,
  MoveArgsSchema,
  MoveSymbolArgsSchema,
  RenameArgsSchema,
  ReplaceTextBaseSchema,
  SearchTextArgsSchema,
  TextEditSchema,
} from "./schema.js";
import { validateWorkspace } from "./security.js";

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
      "Type errors in every modified file are returned automatically (typeErrors, typeErrorCount, typeErrorsTruncated); pass checkTypeErrors:false to suppress. " +
      "If the response contains error DAEMON_STARTING the project graph is still loading — retry the call.",
    inputSchema: {
      file: RenameArgsSchema.shape.file.describe("Absolute path to the file"),
      line: RenameArgsSchema.shape.line.describe("Line number (1-based)"),
      col: RenameArgsSchema.shape.col.describe("Column number (1-based)"),
      newName: RenameArgsSchema.shape.newName.describe("New name for the symbol"),
      checkTypeErrors: RenameArgsSchema.shape.checkTypeErrors.describe(
        "When false, skip the post-write type check; defaults to on",
      ),
    },
  },
  {
    name: "extractFunction",
    description:
      "Pull a block of selected statements out of a function and into a new named function. " +
      "Use this when a function is getting too long, or when a block of code is worth naming for clarity. " +
      "The compiler infers which variables from the enclosing scope become parameters, " +
      "which variables need to be returned, and whether the extracted function should be async. " +
      "The extracted function is placed at module scope (not exported — use moveSymbol to relocate it). " +
      "The selection must cover complete statements — endCol should point at the last character " +
      "of the last statement (the `;` if present, or the last token if the codebase uses no-semi style). " +
      "TypeScript (.ts/.tsx) files only; returns NOT_SUPPORTED for .vue files. " +
      "Type errors in the modified file are returned automatically (typeErrors, typeErrorCount, typeErrorsTruncated); pass checkTypeErrors:false to suppress. " +
      "If the response contains error DAEMON_STARTING the project graph is still loading — retry the call.",
    inputSchema: {
      file: ExtractFunctionArgsSchema.shape.file.describe(
        "Absolute path to the .ts or .tsx file containing the code to extract",
      ),
      startLine: ExtractFunctionArgsSchema.shape.startLine.describe(
        "Start line of the selection (1-based)",
      ),
      startCol: ExtractFunctionArgsSchema.shape.startCol.describe(
        "Start column of the selection (1-based)",
      ),
      endLine: ExtractFunctionArgsSchema.shape.endLine.describe(
        "End line of the selection (1-based)",
      ),
      endCol: ExtractFunctionArgsSchema.shape.endCol.describe(
        "End column of the selection (1-based, inclusive). Must cover the last character of the last statement.",
      ),
      functionName: ExtractFunctionArgsSchema.shape.functionName.describe(
        "Name for the extracted function (must be a valid identifier)",
      ),
      checkTypeErrors: ExtractFunctionArgsSchema.shape.checkTypeErrors.describe(
        "When false, skip the post-write type check; defaults to on",
      ),
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
      "Type errors in every modified file are returned automatically (typeErrors, typeErrorCount, typeErrorsTruncated); pass checkTypeErrors:false to suppress. " +
      "If the response contains error DAEMON_STARTING the project graph is still loading — retry the call.",
    inputSchema: {
      oldPath: MoveArgsSchema.shape.oldPath.describe("Absolute path to the file to move"),
      newPath: MoveArgsSchema.shape.newPath.describe("Absolute destination path"),
      checkTypeErrors: MoveArgsSchema.shape.checkTypeErrors.describe(
        "When false, skip the post-write type check; defaults to on",
      ),
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
      "Type errors in every modified file are returned automatically (typeErrors, typeErrorCount, typeErrorsTruncated); pass checkTypeErrors:false to suppress. " +
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
      checkTypeErrors: MoveSymbolArgsSchema.shape.checkTypeErrors.describe(
        "When false, skip the post-write type check; defaults to on",
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
    name: "getTypeErrors",
    description:
      "Check a TypeScript file or whole project for type errors. " +
      "Use this after making changes to verify you haven't introduced type errors, " +
      "or before starting a refactor to understand the existing error baseline. " +
      "Omit 'file' to check the whole project (capped at 100 errors); provide 'file' for a single-file check. " +
      "Returns each error with its file, line, col, TypeScript error code, and message. " +
      "Only type errors are returned — warnings and suggestions are excluded. " +
      "TS/TSX files only; Vue SFC diagnostics are not yet supported. " +
      "If truncated is true, narrow the scope by providing a specific file. " +
      "If the response contains error DAEMON_STARTING the project graph is still loading — retry the call.",
    inputSchema: {
      file: GetTypeErrorsArgsSchema.shape.file.describe(
        "Absolute path to a single .ts/.tsx file to check (omit to check the whole project)",
      ),
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
      "Type errors in every modified file are returned automatically (typeErrors, typeErrorCount, typeErrorsTruncated); pass checkTypeErrors:false to suppress. " +
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
      checkTypeErrors: ReplaceTextBaseSchema.shape.checkTypeErrors.describe(
        "When false, skip the post-write type check; defaults to on",
      ),
    },
  },
];

/** Tool names derived from the TOOLS table — the single source of truth. Exported for testing only. */
export const TOOL_NAMES: string[] = TOOLS.map((t) => t.name);

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
