import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { dispatchRequest, warmupEngine } from "./dispatcher.js";
import { ensureCacheDir, lockfilePath, socketPath } from "./paths.js";

export function isDaemonAlive(workspaceRoot: string): boolean {
  const lockfile = lockfilePath(workspaceRoot);
  try {
    const pid = parseInt(fs.readFileSync(lockfile, "utf8").trim(), 10);
    if (Number.isNaN(pid)) return false;
    process.kill(pid, 0); // throws if process doesn't exist
    return true;
  } catch {
    return false;
  }
}

export function removeDaemonFiles(workspaceRoot: string): void {
  for (const p of [socketPath(workspaceRoot), lockfilePath(workspaceRoot)]) {
    try {
      fs.unlinkSync(p);
    } catch {
      // already gone
    }
  }
}

export async function runDaemon(opts: { workspace: string }): Promise<void> {
  const absWorkspace = path.resolve(opts.workspace);

  // 1. Validate workspace
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

  // 2. Ensure cache dir exists
  ensureCacheDir();

  const sockPath = socketPath(absWorkspace);
  const pidPath = lockfilePath(absWorkspace);

  // 3. Remove any leftover socket/lockfile from a previous run
  removeDaemonFiles(absWorkspace);

  // 4. Load project graph into memory — warm up the engine for this workspace
  const sentinelPath = path.join(absWorkspace, "__sentinel__");
  await warmupEngine(sentinelPath);

  // 5. Write PID lockfile
  fs.writeFileSync(pidPath, String(process.pid));

  // 6. Open Unix socket and wait for connections
  const server = net.createServer((socket) => {
    let buf = "";
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) void handleSocketRequest(socket, line.trim(), absWorkspace);
      }
    });
    socket.on("error", () => {});
  });

  server.listen(sockPath);

  // 7. Signal readiness
  const readySignal = { status: "ready", workspace: absWorkspace };
  process.stderr.write(`${JSON.stringify(readySignal)}\n`);

  // 8. Clean up on shutdown
  function shutdown(): void {
    server.close();
    removeDaemonFiles(absWorkspace);
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function handleSocketRequest(
  socket: net.Socket,
  line: string,
  workspace: string,
): Promise<void> {
  let response: object;
  try {
    const req = JSON.parse(line) as { method: string; params: Record<string, unknown> };
    response = await dispatchRequest(req, workspace);
  } catch (err) {
    response = {
      ok: false,
      error: "PARSE_ERROR",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  socket.write(`${JSON.stringify(response)}\n`);
}
