import { Command, type CommanderError } from "commander";
import { runMove } from "./commands/move.js";
import { runRename } from "./commands/rename.js";

function jsonError(message: string): void {
  process.stdout.write(`${JSON.stringify({ ok: false, error: "VALIDATION_ERROR", message })}\n`);
  process.exit(1);
}

function commanderExitOverride(err: CommanderError): never {
  jsonError(err.message);
  throw err; // unreachable; jsonError calls process.exit(1)
}

const program = new Command();

program
  .name("passed-on")
  .description("Headless CLI refactoring engine for AI agents")
  .version("0.1.0")
  .configureOutput({ writeErr: () => {} }) // suppress Commander's own stderr text
  .exitOverride(commanderExitOverride);

program
  .command("rename")
  .description("Rename a symbol at a given position across all project files")
  .requiredOption("--file <path>", "Source file containing the symbol")
  .requiredOption("--line <n>", "1-based line number of the symbol")
  .requiredOption("--col <n>", "1-based column number of the symbol")
  .requiredOption("--newName <name>", "New name for the symbol")
  .exitOverride(commanderExitOverride)
  .action(async (opts) => {
    await runRename(opts);
  });

program
  .command("move")
  .description("Move a file and update all import references")
  .requiredOption("--oldPath <path>", "Current file path")
  .requiredOption("--newPath <path>", "Destination file path")
  .exitOverride(commanderExitOverride)
  .action(async (opts) => {
    await runMove(opts);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(`${JSON.stringify({ ok: false, error: "ENGINE_ERROR", message })}\n`);
  process.exit(1);
});
