import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { ensureCacheDir, lockfilePath, removeDaemonFiles, socketPath } from "../daemon/paths.js";
import { getEngine } from "../router.js";

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

  // 4. Load project graph into memory
  const sentinelPath = path.join(absWorkspace, "__sentinel__");
  await getEngine(sentinelPath);

  // 5. Write PID lockfile
  fs.writeFileSync(pidPath, String(process.pid));

  // 6. Open Unix socket and wait for connections
  const server = net.createServer((_socket) => {
    // MCP message loop — to be implemented in mcp-transport feature
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
