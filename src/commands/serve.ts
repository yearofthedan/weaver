import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { isDaemonAlive, removeDaemonFiles, socketPath } from "../daemon/paths.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI_ENTRY = path.resolve(__dirname, "..", "..", "src", "cli.ts");
const TSX_BIN = path.resolve(__dirname, "..", "..", "node_modules", ".bin", "tsx");

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

  // 3. Ensure a live daemon is running for this workspace
  await ensureDaemon(absWorkspace);

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

  // 6. Keep stdin open for the MCP message loop (to be added in mcp-transport)
  process.stdin.resume();
}

/**
 * Ensure a daemon is running for the workspace. If the socket exists but the
 * process is gone (stale), clean it up first. Then auto-spawn if needed and
 * wait for the ready signal.
 */
async function ensureDaemon(absWorkspace: string): Promise<void> {
  const sockPath = socketPath(absWorkspace);

  // If socket file exists but process is dead, remove stale files
  if (fs.existsSync(sockPath) && !isDaemonAlive(absWorkspace)) {
    removeDaemonFiles(absWorkspace);
  }

  // If daemon is already live, nothing to do
  if (isDaemonAlive(absWorkspace)) {
    return;
  }

  // Auto-spawn the daemon as a detached child so it outlives this process
  await spawnDaemon(absWorkspace);
}

function spawnDaemon(absWorkspace: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [CLI_ENTRY, "daemon", "--workspace", absWorkspace], {
      stdio: ["ignore", "ignore", "pipe"],
      detached: true,
    });

    let stderrBuf = "";

    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for daemon ready signal"));
    }, 30_000);

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      for (const line of stderrBuf.split("\n")) {
        try {
          const msg = JSON.parse(line.trim());
          if (msg.status === "ready") {
            clearTimeout(timer);
            child.unref();
            resolve();
          }
        } catch {
          // not JSON, ignore
        }
      }
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Daemon exited unexpectedly with code ${code}`));
    });
  });
}
