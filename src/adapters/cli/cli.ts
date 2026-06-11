#!/usr/bin/env node
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { Command, type CommanderError } from "commander";
import { runDaemon, runStop } from "../../daemon/daemon.js";
import { NodeFileSystem } from "../../ports/filesystem.js";
import { deriveSkillNamesFromPackageJson, installSkills } from "./install-skills.js";
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

const program = new Command();

program
  .name("weaver")
  .description("Headless CLI refactoring engine for AI agents")
  .version("0.1.0")
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
  .action(async (opts: { dir: string; force?: boolean }) => {
    const __filename = fileURLToPath(import.meta.url);
    const pkgRoot = nodePath.resolve(nodePath.dirname(__filename), "../../..");
    const packageJsonPath = nodePath.join(pkgRoot, "package.json");
    const sourceDir = nodePath.join(pkgRoot, ".claude/skills");
    const destDir = nodePath.resolve(opts.dir);
    const fs = new NodeFileSystem();

    const packageJsonContent = fs.readFile(packageJsonPath);
    const skillNames = deriveSkillNamesFromPackageJson(packageJsonContent);
    const report = installSkills(skillNames, sourceDir, destDir, fs, {
      force: opts.force ?? false,
    });

    for (const { name, outcome } of report) {
      switch (outcome) {
        case "installed":
          process.stdout.write(
            `installed ${name} → ${nodePath.join(opts.dir, name, "SKILL.md")}\n`,
          );
          break;
        case "up-to-date":
          process.stdout.write(`up-to-date ${name}\n`);
          break;
        case "skipped-diverged":
          process.stdout.write(`skipped ${name} (diverged; use --force to overwrite)\n`);
          break;
        case "overwritten":
          process.stdout.write(`overwritten ${name}\n`);
          break;
      }
    }
  });

registerOperationSubcommands(program, commanderExitOverride);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(`${JSON.stringify({ ok: false, error: "ENGINE_ERROR", message })}\n`);
  process.exit(1);
});
