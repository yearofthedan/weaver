/**
 * eval/run-eval.ts — entry point for `pnpm eval`
 *
 * 1. Creates the eval workspace directory
 * 2. Starts the fixture server (impersonates the real daemon)
 * 3. Runs `promptfoo eval` pointing at eval/promptfooconfig.yaml
 * 4. Tears down the fixture server and exits with promptfoo's exit code
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const EVAL_WORKSPACE = "/tmp/light-bridge-eval";
const FIXTURES_DIR = path.join(__dirname, "fixtures");

if (!process.env.ANTHROPIC_API_KEY) {
  process.stderr.write(
    "Error: ANTHROPIC_API_KEY is not set. The eval sends requests to the Anthropic API.\n",
  );
  process.exit(1);
}

fs.mkdirSync(EVAL_WORKSPACE, { recursive: true });

const stop = await startFixtureServer(EVAL_WORKSPACE, FIXTURES_DIR);

const promptfooArgs = ["eval", "-c", path.join(__dirname, "promptfooconfig.yaml"), "--no-cache"];

// Forward any extra CLI args (e.g. --filter-pattern) to promptfoo
const extraArgs = process.argv.slice(2);
promptfooArgs.push(...extraArgs);

const promptfoo = spawn(
  path.join(PROJECT_ROOT, "node_modules", ".bin", "promptfoo"),
  promptfooArgs,
  {
    stdio: "inherit",
    cwd: PROJECT_ROOT,
  },
);

promptfoo.on("error", (err) => {
  stop();
  process.stderr.write(`Failed to start promptfoo: ${err.message}\n`);
  process.exit(1);
});

promptfoo.on("exit", (code) => {
  stop();
  process.exit(code ?? 0);
});
