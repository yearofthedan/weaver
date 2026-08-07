#!/usr/bin/env node
import { readFileSync } from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { Command, type CommanderError } from "commander";
import { runDaemon, runStop } from "../../daemon/daemon.js";
import { NodeFileSystem } from "../../ports/filesystem.js";
import { runInstallSkills } from "./install-skills.js";
import { registerOperationSubcommands } from "./operations.js";

function jsonError(message: string): void {
  process.stdout.write(`${JSON.stringify({ ok: false, error: "VALIDATION_ERROR", message })}\n`);
  process.exit(1);
}

function commanderExitOverride(err: CommanderError): never {
  if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
    process.exit(0);
  }
  jsonError(err.message);
  throw err; // unreachable; jsonError calls process.exit(1)
}

// cli.js sits at dist/adapters/cli/, so the package root is three levels up.
const pkgRoot = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "../../..");

function readPackageVersion(root: string): string {
  const pkg = JSON.parse(readFileSync(nodePath.join(root, "package.json"), "utf-8")) as {
    version: string;
  };
  return pkg.version;
}

const program = new Command();

program
  .name("weaver")
  .description("Headless CLI refactoring engine for AI agents")
  .version(readPackageVersion(pkgRoot))
  .configureOutput({ writeErr: () => {} }) // suppress Commander's own stderr text
  .exitOverride(commanderExitOverride);

program
  .command("daemon")
  .description("Start a long-lived daemon process for a workspace")
  .option("--workspace <path>", "Root directory of the project to serve", process.cwd())
  .option("--verbose", "Write structured JSON log lines to the cache directory")
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

const skills = program.command("skills").description("Manage weaver skill files");

skills
  .command("install")
  .description("Copy shipped skills from the installed package into a project skills directory")
  .option(
    "--dir <path>",
    "Destination skills directory",
    nodePath.join(process.cwd(), ".claude/skills"),
  )
  .option("--force", "Overwrite destination skills that have diverged from the shipped version")
  .exitOverride(commanderExitOverride)
  .action((opts: { dir: string; force?: boolean }) => {
    runInstallSkills(opts, {
      fs: new NodeFileSystem(),
      pkgRoot,
      write: (line) => process.stdout.write(line),
    });
  });

registerOperationSubcommands(program, commanderExitOverride);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(`${JSON.stringify({ ok: false, error: "ENGINE_ERROR", message })}\n`);
  process.exit(1);
});
