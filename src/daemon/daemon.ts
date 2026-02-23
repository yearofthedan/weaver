import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { EngineError } from "../utils/errors.js";
import { TS_EXTENSIONS, VUE_EXTENSIONS } from "../utils/file-walk.js";
import { findTsConfigForFile, isVueProject } from "../utils/ts-project.js";
import { validateWorkspace } from "../workspace.js";
import { dispatchRequest, invalidateAll, invalidateFile } from "./dispatcher.js";
import { ensureCacheDir, lockfilePath, socketPath } from "./paths.js";
import { startWatcher } from "./watcher.js";

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
  // 1. Validate workspace (existence, directory, not a restricted system path)
  const wsResult = validateWorkspace(opts.workspace);
  if (!wsResult.ok) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: "VALIDATION_ERROR", message: wsResult.error })}\n`,
    );
    process.exit(1);
  }
  const absWorkspace = wsResult.workspace;

  // 2. Ensure cache dir exists
  ensureCacheDir();

  const sockPath = socketPath(absWorkspace);
  const pidPath = lockfilePath(absWorkspace);

  // 3. Remove any leftover socket/lockfile from a previous run
  removeDaemonFiles(absWorkspace);

  // 4. Write PID lockfile
  fs.writeFileSync(pidPath, String(process.pid));

  // 5. Open Unix socket and wait for connections
  // Serialise all incoming requests with a promise-chain mutex. If two
  // requests arrive concurrently (e.g. an MCP host retry while the first
  // request is still in-flight), the second waits for the first to finish
  // before dispatchRequest is called. Prevents interleaved file writes.
  let queue: Promise<void> = Promise.resolve();
  const server = net.createServer((socket) => {
    let buf = "";
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          const trimmed = line.trim();
          queue = queue.then(() => handleSocketRequest(socket, trimmed, absWorkspace));
        }
      }
    });
    socket.on("error", () => {});
  });

  server.listen(sockPath);

  // 6. Watch for out-of-band file changes and invalidate stale provider state.
  // Extensions are chosen by project type — Vue projects also watch .vue files.
  const sentinelPath = path.join(absWorkspace, "__sentinel__");
  const tsConfigPath = findTsConfigForFile(sentinelPath);
  const watchExtensions =
    tsConfigPath && isVueProject(tsConfigPath) ? VUE_EXTENSIONS : TS_EXTENSIONS;

  const watcher = startWatcher(absWorkspace, watchExtensions, {
    onFileChanged: invalidateFile,
    onFileAdded: invalidateAll,
    onFileRemoved: invalidateAll,
  });

  // 7. Signal readiness
  const readySignal = { status: "ready", workspace: absWorkspace };
  process.stderr.write(`${JSON.stringify(readySignal)}\n`);

  // 8. Clean up on shutdown
  function shutdown(): void {
    void watcher.stop();
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
      error: EngineError.is(err) ? err.code : "PARSE_ERROR",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  socket.write(`${JSON.stringify(response)}\n`);
}
