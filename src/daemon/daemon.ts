import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { z } from "zod";
import { validateWorkspace } from "../security.js";
import { EngineError } from "../utils/errors.js";
import { TS_EXTENSIONS, VUE_EXTENSIONS } from "../utils/file-walk.js";
import { findTsConfigForFile, isVueProject } from "../utils/ts-project.js";
import { dispatchRequest, invalidateAll, invalidateFile } from "./dispatcher.js";
import { ensureCacheDir, lockfilePath, socketPath } from "./paths.js";
import { startWatcher } from "./watcher.js";

/**
 * Increment whenever a new operation is added or an existing one changes its
 * wire format. `ensureDaemon` checks this against a live daemon's `ping`
 * response and respawns on mismatch so stale daemons are never silently reused.
 */
export const PROTOCOL_VERSION = 1;

function readLockfile(workspaceRoot: string): { pid: number; startedAt: number } | null {
  try {
    const raw = fs.readFileSync(lockfilePath(workspaceRoot), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).pid === "number" &&
      typeof (parsed as Record<string, unknown>).startedAt === "number"
    ) {
      return parsed as { pid: number; startedAt: number };
    }
    return null;
  } catch {
    return null;
  }
}

export function isDaemonAlive(workspaceRoot: string): boolean {
  const lock = readLockfile(workspaceRoot);
  if (lock === null) return false;
  try {
    process.kill(lock.pid, 0); // throws if process doesn't exist
  } catch {
    return false;
  }
  // A running daemon always has a socket file. If the socket is gone but the
  // PID is alive, it's likely a recycled PID from a crashed daemon.
  return fs.existsSync(socketPath(workspaceRoot));
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

/**
 * Send SIGTERM to the daemon for this workspace, wait up to `timeoutMs` for
 * it to stop, then remove any leftover socket/lockfile. Safe to call when no
 * daemon is running — it's a no-op in that case.
 */
export async function stopDaemon(workspaceRoot: string, timeoutMs = 5_000): Promise<void> {
  const lock = readLockfile(workspaceRoot);
  if (lock === null) return;
  try {
    process.kill(lock.pid, "SIGTERM");
  } catch {
    // already gone
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isDaemonAlive(workspaceRoot)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  removeDaemonFiles(workspaceRoot);
}

export async function runStop(opts: { workspace: string }): Promise<void> {
  const wsResult = validateWorkspace(opts.workspace);
  if (!wsResult.ok) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: "VALIDATION_ERROR", message: wsResult.error })}\n`,
    );
    process.exit(1);
  }
  const absWorkspace = wsResult.workspace;

  if (!isDaemonAlive(absWorkspace)) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, stopped: false, message: "No daemon running for this workspace" })}\n`,
    );
    return;
  }

  const lock = readLockfile(absWorkspace);
  if (lock === null) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: "ENGINE_ERROR", message: "Could not read lockfile" })}\n`,
    );
    process.exit(1);
  }
  process.kill(lock.pid, "SIGTERM");

  // Wait for daemon to stop; it removes its own files on SIGTERM
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isDaemonAlive(absWorkspace)) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  // Defensive cleanup in case the daemon didn't remove files before exiting
  removeDaemonFiles(absWorkspace);

  if (isDaemonAlive(absWorkspace)) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: "ENGINE_ERROR", message: "Daemon did not stop within the timeout" })}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`${JSON.stringify({ ok: true, stopped: true })}\n`);
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

  // 4. Write PID lockfile (JSON with pid + startedAt to detect recycled PIDs)
  fs.writeFileSync(pidPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));

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

const RequestEnvelopeSchema = z.object({
  method: z.string().min(1, "method is required"),
  params: z.record(z.unknown()).default({}),
});

async function handleSocketRequest(
  socket: net.Socket,
  line: string,
  workspace: string,
): Promise<void> {
  let response: object;
  try {
    const raw: unknown = JSON.parse(line);
    const envelope = RequestEnvelopeSchema.safeParse(raw);
    if (!envelope.success) {
      const message = envelope.error.issues.map((i) => i.message).join("; ");
      response = { ok: false, error: "PARSE_ERROR", message };
    } else if (envelope.data.method === "ping") {
      response = { ok: true, version: PROTOCOL_VERSION };
    } else {
      response = await dispatchRequest(envelope.data, workspace);
    }
  } catch (err) {
    response = {
      ok: false,
      error: EngineError.is(err) ? err.code : "PARSE_ERROR",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  socket.write(`${JSON.stringify(response)}\n`);
}
