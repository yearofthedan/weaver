import * as path from "node:path";
import type { Command, CommanderError } from "commander";
import { z } from "zod";
import { callDaemon, ensureDaemon } from "../../daemon/ensure-daemon.js";
import { socketPath } from "../../daemon/paths.js";
import { resolveRelativePaths } from "../../utils/resolve-path-params.js";
import {
  DeleteFileArgsSchema,
  ExtractFunctionArgsSchema,
  FindImportersArgsSchema,
  FindReferencesArgsSchema,
  GetDefinitionArgsSchema,
  GetTypeErrorsArgsSchema,
  MoveArgsSchema,
  MoveDirectoryArgsSchema,
  MoveSymbolArgsSchema,
  RenameArgsSchema,
  ReplaceTextBaseSchema,
  SearchTextArgsSchema,
} from "../schema.js";
import { classifyDaemonError } from "./classify-error.js";

/**
 * Maps each kebab-case CLI subcommand name to the camelCase daemon method name
 * and lists which JSON keys hold file paths (for relative→absolute resolution).
 */
const SUBCOMMANDS: Record<
  string,
  { method: string; pathParams: string[]; schema: z.ZodType | null }
> = {
  rename: { method: "rename", pathParams: ["file"], schema: RenameArgsSchema },
  "move-file": { method: "moveFile", pathParams: ["oldPath", "newPath"], schema: MoveArgsSchema },
  "move-directory": {
    method: "moveDirectory",
    pathParams: ["oldPath", "newPath"],
    schema: MoveDirectoryArgsSchema,
  },
  "move-symbol": {
    method: "moveSymbol",
    pathParams: ["sourceFile", "destFile"],
    schema: MoveSymbolArgsSchema,
  },
  "extract-function": {
    method: "extractFunction",
    pathParams: ["file"],
    schema: ExtractFunctionArgsSchema,
  },
  "find-importers": {
    method: "findImporters",
    pathParams: ["file"],
    schema: FindImportersArgsSchema,
  },
  "find-references": {
    method: "findReferences",
    pathParams: ["file"],
    schema: FindReferencesArgsSchema,
  },
  "get-definition": {
    method: "getDefinition",
    pathParams: ["file"],
    schema: GetDefinitionArgsSchema,
  },
  "get-type-errors": {
    method: "getTypeErrors",
    pathParams: [],
    schema: GetTypeErrorsArgsSchema,
  },
  "search-text": { method: "searchText", pathParams: [], schema: SearchTextArgsSchema },
  "delete-file": { method: "deleteFile", pathParams: ["file"], schema: DeleteFileArgsSchema },
  "replace-text": { method: "replaceText", pathParams: [], schema: ReplaceTextBaseSchema },
};

export function writeJsonError(error: string, message: string): void {
  process.stdout.write(`${JSON.stringify({ status: "error", error, message })}\n`);
}

/**
 * Render a parameter breakdown block from a Zod object schema. Derives each
 * field's name, description, and whether it's optional from the schema, so the
 * help text can never drift from validation. Type is left to the description
 * (e.g. "Line number (1-based)") rather than coupling the help to Zod's
 * type-name rendering.
 */
function renderParamsHelp(schema: z.ZodType): string {
  const json = z.toJSONSchema(schema);
  const required = new Set(json.required ?? []);
  const rows: { name: string; desc: string }[] = [];
  for (const [name, prop] of Object.entries(json.properties ?? {})) {
    // JSON Schema permits a boolean in place of a property schema; ours never are.
    if (typeof prop === "boolean") continue;
    const optional = required.has(name) ? "" : "(optional) ";
    rows.push({ name, desc: `${optional}${prop.description ?? ""}` });
  }
  if (rows.length === 0) return "";

  const nameWidth = Math.max(...rows.map((r) => r.name.length));
  const lines = ["\nJSON parameters:"];
  for (const r of rows) {
    lines.push(`  ${r.name.padEnd(nameWidth)}  ${r.desc}`);
  }
  return lines.join("\n");
}

/**
 * Register all operation subcommands on the given Commander program.
 * Each subcommand accepts a single positional JSON argument or reads from stdin
 * when stdin is not a TTY.
 */
export function registerOperationSubcommands(
  program: Command,
  exitOverride: (err: CommanderError) => never,
): void {
  for (const [subcommand, { method, pathParams, schema }] of Object.entries(SUBCOMMANDS)) {
    const cmd = program
      .command(`${subcommand} [json]`)
      .description(`Invoke the ${method} operation`)
      .option("--workspace <path>", "Root directory of the project", process.cwd())
      .exitOverride(exitOverride);

    if (schema !== null) {
      cmd.addHelpText("after", () => renderParamsHelp(schema));
    }

    cmd.action(async (jsonArg: string | undefined, opts: { workspace: string }) => {
      const workspace = path.resolve(opts.workspace);

      const raw = await resolveInput(jsonArg, subcommand);
      if (raw === null) return; // resolveInput already printed help and exited

      let params: Record<string, unknown>;
      try {
        params = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        writeJsonError("VALIDATION_ERROR", `Invalid JSON: ${raw}`);
        process.exit(1);
      }

      resolveRelativePaths(params, pathParams, workspace);

      try {
        await ensureDaemon(workspace);
        const response = await callDaemon(socketPath(workspace), { method, params });
        process.stdout.write(`${JSON.stringify(response)}\n`);

        if ((response as Record<string, unknown>).status === "error") {
          process.exit(1);
        }
      } catch (err: unknown) {
        const errorCode = classifyDaemonError(err);
        const message = err instanceof Error ? err.message : String(err);
        writeJsonError(errorCode, message);
        process.exit(1);
      }
    });
  }
}

async function resolveInput(
  jsonArg: string | undefined,
  subcommand: string,
): Promise<string | null> {
  if (jsonArg !== undefined) return jsonArg;
  if (!process.stdin.isTTY) return readStdin();
  writeJsonError(
    "VALIDATION_ERROR",
    `No JSON argument provided. Usage: weaver ${subcommand} '<json>'`,
  );
  process.exit(1);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buf += chunk;
    });
    process.stdin.on("end", () => resolve(buf.trim()));
  });
}
