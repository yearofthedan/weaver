import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callDaemon, ensureDaemon } from "./daemon/ensure-daemon.js";
import { socketPath } from "./daemon/paths.js";
import {
  DeleteFileArgsSchema,
  ExtractFunctionArgsSchema,
  FindReferencesArgsSchema,
  GetDefinitionArgsSchema,
  GetTypeErrorsArgsSchema,
  MoveArgsSchema,
  MoveDirectoryArgsSchema,
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
      "Scope-aware — won't touch unrelated identifiers that share the same name in other scopes. " +
      "Returns filesModified (no need to read them to verify) and filesSkipped (outside workspace, not written — surface to user). " +
      "Type errors in modified files are returned automatically (typeErrors, typeErrorCount, typeErrorsTruncated); pass checkTypeErrors:false to suppress.",
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
      "When a function is too long or a block of code is worth naming, use this to extract it into a new function. " +
      "The compiler infers parameters, return values, type annotations, and async propagation automatically. " +
      "The extracted function is placed at module scope (not exported — use moveSymbol to relocate it). " +
      "The selection must cover complete statements — endCol must point at the last character " +
      "of the last statement (the `;` if present, or the last token in no-semi style). " +
      ".ts/.tsx only; returns NOT_SUPPORTED for .vue files. " +
      "Type errors in the modified file are returned automatically (typeErrors, typeErrorCount, typeErrorsTruncated); pass checkTypeErrors:false to suppress.",
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
      "When relocating a file, use this instead of shell mv — it rewrites every import that references the file, project-wide. " +
      "Creates the destination directory if needed. Works for non-source files (tests, scripts, config) too. " +
      "Returns filesModified and filesSkipped (outside workspace, not written — surface to user). " +
      "Type errors in modified files are returned automatically (typeErrors, typeErrorCount, typeErrorsTruncated); pass checkTypeErrors:false to suppress.",
    inputSchema: {
      oldPath: MoveArgsSchema.shape.oldPath.describe("Absolute path to the file to move"),
      newPath: MoveArgsSchema.shape.newPath.describe("Absolute destination path"),
      checkTypeErrors: MoveArgsSchema.shape.checkTypeErrors.describe(
        "When false, skip the post-write type check; defaults to on",
      ),
    },
  },
  {
    name: "moveDirectory",
    description:
      "When restructuring project layout, use this to move an entire directory and rewrite every import across the project automatically. " +
      "Handles nested subdirectories, preserves internal structure, and updates all external references. " +
      "Use this instead of multiple moveFile calls when relocating a folder. " +
      "Returns filesMoved (files that were relocated), filesModified (all files with rewritten imports, including the moved files), and filesSkipped (outside workspace, not written). " +
      "Type errors in modified files are returned automatically; pass checkTypeErrors:false to suppress.",
    inputSchema: {
      oldPath: MoveDirectoryArgsSchema.shape.oldPath.describe(
        "Absolute path to the source directory",
      ),
      newPath: MoveDirectoryArgsSchema.shape.newPath.describe(
        "Absolute path to the destination directory (created if needed; must not already exist as a non-empty directory)",
      ),
      checkTypeErrors: MoveDirectoryArgsSchema.shape.checkTypeErrors.describe(
        "When false, skip the post-write type check; defaults to on",
      ),
    },
  },
  {
    name: "moveSymbol",
    description:
      "When reorganising modules, use this to move a named export to another file — " +
      "it finds and updates every importer project-wide automatically; no need to call findReferences first. " +
      "Creates the destination file if it does not exist. " +
      "If the destination already exports a symbol with the same name, returns SYMBOL_EXISTS — " +
      "pass force: true to replace the existing declaration with the source version and rewrite importers. " +
      "Only top-level exported declarations (export function, export const, export class, etc.); " +
      "does not support class methods or re-exports via `export { }`. " +
      "Returns filesModified and filesSkipped (outside workspace, not written — surface to user). " +
      "Type errors in modified files are returned automatically (typeErrors, typeErrorCount, typeErrorsTruncated); pass checkTypeErrors:false to suppress.",
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
      force: MoveSymbolArgsSchema.shape.force.describe(
        "When true and the destination already exports a symbol with the same name, replace the existing declaration with the source version. When false or omitted, returns SYMBOL_EXISTS error on conflict.",
      ),
      checkTypeErrors: MoveSymbolArgsSchema.shape.checkTypeErrors.describe(
        "When false, skip the post-write type check; defaults to on",
      ),
    },
  },
  {
    name: "deleteFile",
    description:
      "When deleting a file, use this instead of shell rm — it removes every import and re-export of the file from other project files before deleting it. " +
      "Covers in-project source files, out-of-project files (tests, scripts), and Vue SFC script blocks. " +
      "Returns deletedFile (echo of the path deleted), filesModified (imports cleaned), filesSkipped (outside workspace, not written — surface to user), and importRefsRemoved. " +
      "Type errors in modified files are returned automatically (typeErrors, typeErrorCount, typeErrorsTruncated); pass checkTypeErrors:false to suppress.",
    inputSchema: {
      file: DeleteFileArgsSchema.shape.file.describe(
        "Absolute path to the .ts, .tsx, .js, .jsx, or .vue file to delete",
      ),
      checkTypeErrors: DeleteFileArgsSchema.shape.checkTypeErrors.describe(
        "When false, skip the post-write type check on modified files; defaults to on",
      ),
    },
  },
  {
    name: "findReferences",
    description:
      "Before modifying, moving, or deleting a symbol, use this to see every file that depends on it. " +
      "The compiler tracks references through re-exports, barrel files, type-only imports, and Vue SFCs — " +
      "scope-aware, so it ignores unrelated identifiers with the same name. " +
      "Returns a references array of {file, line, col} including the declaration site.",
    inputSchema: {
      file: FindReferencesArgsSchema.shape.file.describe("Absolute path to the file"),
      line: FindReferencesArgsSchema.shape.line.describe("Line number (1-based)"),
      col: FindReferencesArgsSchema.shape.col.describe("Column number (1-based)"),
    },
  },
  {
    name: "getDefinition",
    description:
      "When you need to find where a symbol is declared, use this instead of text search. " +
      "Resolves through re-exports, barrel files, and declaration files to the actual definition. " +
      "Returns a definitions array of {file, line, col}.",
    inputSchema: {
      file: GetDefinitionArgsSchema.shape.file.describe("Absolute path to the file"),
      line: GetDefinitionArgsSchema.shape.line.describe("Line number (1-based)"),
      col: GetDefinitionArgsSchema.shape.col.describe("Column number (1-based)"),
    },
  },
  {
    name: "getTypeErrors",
    description:
      "Check for type errors after making changes, or before a refactor to understand the existing baseline. " +
      "Omit 'file' to check the whole project (capped at 100); provide 'file' for a single-file check. " +
      "Returns diagnostics array with file, line, col, TypeScript error code, and message. Errors only — no warnings or suggestions. " +
      ".ts/.tsx only; Vue SFC diagnostics are not yet supported. " +
      "If truncated is true, narrow the scope by providing a specific file.",
    inputSchema: {
      file: GetTypeErrorsArgsSchema.shape.file.describe(
        "Absolute path to a single .ts/.tsx file to check (omit to check the whole project)",
      ),
    },
  },
  {
    name: "searchText",
    description:
      "Find where a string literal, import path, or any text pattern appears across the workspace. " +
      "Returns structured matches (file, line, col, matchText) that feed directly into replaceText's surgical edit mode. " +
      "Sensitive files (.env, keys, certificates) are never scanned. " +
      "If truncated is true, results were capped — narrow with a more specific pattern or glob.",
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
      "Edit text across workspace files. " +
      "Two modes: " +
      "(1) Pattern mode — 'pattern' (regex) + 'replacement' applies the substitution directly across all matching files, optionally narrowed by 'glob'; supports $1, $2, ... backreferences. " +
      "(2) Surgical mode — 'edits' array of {file, line, col, oldText, newText} for exact position-verified replacements; " +
      "run searchText first to locate targets and get coordinates; oldText is checked before writing, so stale edits fail rather than corrupt. " +
      "Both modes skip sensitive files. Returns filesModified and replacementCount. " +
      "Type errors in modified files are returned automatically (typeErrors, typeErrorCount, typeErrorsTruncated); pass checkTypeErrors:false to suppress.",
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
