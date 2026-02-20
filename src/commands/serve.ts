import * as fs from "node:fs";
import * as path from "node:path";
import { getEngine } from "../router.js";

export async function runServe(opts: { workspace: string }): Promise<void> {
  // 1. Resolve workspace to absolute path
  const absWorkspace = path.resolve(opts.workspace);

  // 2. Validate workspace exists and is a directory
  if (!fs.existsSync(absWorkspace)) {
    const error = {
      ok: false,
      error: "VALIDATION_ERROR",
      message: `Workspace directory not found: ${opts.workspace}`,
    };
    process.stdout.write(`${JSON.stringify(error)}\n`);
    process.exit(1);
  }

  if (!fs.statSync(absWorkspace).isDirectory()) {
    const error = {
      ok: false,
      error: "VALIDATION_ERROR",
      message: `Workspace is not a directory: ${opts.workspace}`,
    };
    process.stdout.write(`${JSON.stringify(error)}\n`);
    process.exit(1);
  }

  // 3. Pre-warm the engine by triggering tsconfig discovery and engine instantiation
  try {
    const sentinelPath = path.join(absWorkspace, "__sentinel__");
    await getEngine(sentinelPath);
  } catch {
    // Engine pre-warming is best-effort; ignore errors
  }

  // 4. Register signal handlers for clean shutdown
  process.on("SIGTERM", () => {
    process.exit(0);
  });

  process.on("SIGINT", () => {
    process.exit(0);
  });

  // 5. Write readiness signal to stderr
  const readySignal = { status: "ready", workspace: absWorkspace };
  process.stderr.write(`${JSON.stringify(readySignal)}\n`);

  // 6. Keep stdin open (do not close) for the MCP message loop to be added later
  process.stdin.resume();
}
