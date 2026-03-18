#!/usr/bin/env node
import { Command, type CommanderError } from "commander";
import { runServe } from "./adapters/mcp/mcp.js";
import { runDaemon, runStop } from "./daemon/daemon.js";

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
  .name("light-bridge")
  .description("Headless CLI refactoring engine for AI agents")
  .version("0.1.0")
  .configureOutput({ writeErr: () => {} }) // suppress Commander's own stderr text
  .exitOverride(commanderExitOverride);

program
  .command("daemon")
  .description("Start a long-lived daemon process for a workspace")
  .option("--workspace <path>", "Root directory of the project to serve", process.cwd())
  .exitOverride(commanderExitOverride)
  .action(async (opts) => {
    await runDaemon(opts);
  });

program
  .command("stop")
  .description("Stop a running daemon process for a workspace")
  .option("--workspace <path>", "Root directory of the project to stop", process.cwd())
  .exitOverride(commanderExitOverride)
  .action(async (opts) => {
    await runStop(opts);
  });

program
  .command("serve")
  .description("Start a server for refactoring operations")
  .option("--workspace <path>", "Root directory of the project to serve", process.cwd())
  .exitOverride(commanderExitOverride)
  .action(async (opts) => {
    await runServe(opts);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(`${JSON.stringify({ ok: false, error: "ENGINE_ERROR", message })}\n`);
  process.exit(1);
});
