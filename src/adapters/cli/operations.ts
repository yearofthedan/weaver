import * as path from "node:path";
import type { Command, CommanderError } from "commander";
import { callDaemon, ensureDaemon } from "../../daemon/ensure-daemon.js";
import { socketPath } from "../../daemon/paths.js";
import { classifyDaemonError } from "../mcp/classify-error.js";

/**
 * Maps each kebab-case CLI subcommand name to the camelCase daemon method name
 * and lists which JSON keys hold file paths (for relative→absolute resolution).
 */
const SUBCOMMANDS: Record<string, { method: string; pathParams: string[] }> = {
  rename: { method: "rename", pathParams: ["file"] },
  "move-file": { method: "moveFile", pathParams: ["oldPath", "newPath"] },
  "move-directory": { method: "moveDirectory", pathParams: ["oldPath", "newPath"] },
  "move-symbol": { method: "moveSymbol", pathParams: ["sourceFile", "destFile"] },
  "extract-function": { method: "extractFunction", pathParams: ["file"] },
  "find-references": { method: "findReferences", pathParams: ["file"] },
  "get-definition": { method: "getDefinition", pathParams: ["file"] },
  "get-type-errors": { method: "getTypeErrors", pathParams: [] },
  "search-text": { method: "searchText", pathParams: [] },
  "delete-file": { method: "deleteFile", pathParams: ["file"] },
  "replace-text": { method: "replaceText", pathParams: [] },
};

function writeJsonError(error: string, message: string): void {
  process.stdout.write(`${JSON.stringify({ status: "error", error, message })}\n`);
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
  for (const [subcommand, { method, pathParams }] of Object.entries(SUBCOMMANDS)) {
    program
      .command(`${subcommand} [json]`)
      .description(`Invoke the ${method} operation`)
      .option("--workspace <path>", "Root directory of the project", process.cwd())
      .exitOverride(exitOverride)
      .action(async (jsonArg: string | undefined, opts: { workspace: string }) => {
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

        for (const key of pathParams) {
          const val = params[key];
          if (typeof val === "string" && !path.isAbsolute(val)) {
            params[key] = path.resolve(workspace, val);
          }
        }

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
