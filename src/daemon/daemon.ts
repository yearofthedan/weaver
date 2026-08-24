import * as net from "node:net";
import { z } from "zod";
import type { FileSystem } from "../ports/filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { VUE_EXTENSIONS } from "../utils/extensions.js";
import { readBuildId } from "./build-id.js";
import type { DispatchResponse } from "./dispatcher.js";
import { dispatchRequest, invalidateAll, invalidateFile } from "./dispatcher.js";
import type { DaemonHost } from "./lifecycle.js";
import { runLifecycle } from "./lifecycle.js";
import type { DaemonLogger } from "./logger.js";
import { createLogger } from "./logger.js";
import { ensureCacheDir, lockfilePath, socketPath } from "./paths.js";
import { validateWorkspace } from "./validate-workspace.js";
import { startWatcher } from "./watcher.js";

/**
 * Identity of the build this process is running, captured at module load
 * rather than read per request.
 *
 * A rebuild replaces the entry file on disk while this process keeps serving
 * the code it already loaded, so reading the mtime per ping would report the
 * daemon as current at exactly the moment it went stale.
 */
const RUNNING_BUILD_ID = readBuildId();

/**
 * Filesystem reads go through the injected `FileSystem` port so the daemon
 * control-plane is testable in memory. Callers that legitimately touch real
 * disk rely on this production default.
 */
const defaultFs = new NodeFileSystem();

function readLockfile(
  workspaceRoot: string,
  fs: FileSystem = defaultFs,
): { pid: number; startedAt: number } | null {
  try {
    const raw = fs.readFile(lockfilePath(workspaceRoot));
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

export function isDaemonAlive(workspaceRoot: string, fs: FileSystem = defaultFs): boolean {
  const lock = readLockfile(workspaceRoot, fs);
  if (lock === null) return false;
  try {
    process.kill(lock.pid, 0); // throws if process doesn't exist
  } catch {
    return false;
  }
  // A running daemon always has a socket file. If the socket is gone but the
  // PID is alive, it's likely a recycled PID from a crashed daemon.
  return fs.exists(socketPath(workspaceRoot));
}

export function removeDaemonFiles(workspaceRoot: string, fs: FileSystem = defaultFs): void {
  for (const p of [socketPath(workspaceRoot), lockfilePath(workspaceRoot)]) {
    try {
      fs.unlink(p);
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
export async function stopDaemon(
  workspaceRoot: string,
  opts: { timeoutMs?: number; fs?: FileSystem } = {},
): Promise<void> {
  const { timeoutMs = 5_000, fs = defaultFs } = opts;
  const lock = readLockfile(workspaceRoot, fs);
  if (lock === null) return;
  try {
    process.kill(lock.pid, "SIGTERM");
  } catch {
    // already gone
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isDaemonAlive(workspaceRoot, fs)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  removeDaemonFiles(workspaceRoot, fs);
}

export async function runStop(opts: { workspace: string }): Promise<void> {
  const wsResult = validateWorkspace(opts.workspace, new NodeFileSystem());
  if (!wsResult.ok) {
    process.stdout.write(
      `${JSON.stringify({ status: "error", error: "VALIDATION_ERROR", message: wsResult.error })}\n`,
    );
    process.exit(1);
  }
  const absWorkspace = wsResult.workspace;

  if (!isDaemonAlive(absWorkspace)) {
    process.stdout.write(
      `${JSON.stringify({ status: "success", stopped: false, message: "No daemon running for this workspace" })}\n`,
    );
    return;
  }

  const lock = readLockfile(absWorkspace);
  if (lock === null) {
    process.stdout.write(
      `${JSON.stringify({ status: "error", error: "ENGINE_ERROR", message: "Could not read lockfile" })}\n`,
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
      `${JSON.stringify({ status: "error", error: "ENGINE_ERROR", message: "Daemon did not stop within the timeout" })}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`${JSON.stringify({ status: "success", stopped: true })}\n`);
}

function resolveVerbose(opts: { verbose?: boolean }): boolean {
  if (opts.verbose !== undefined) return opts.verbose;
  return process.env.WEAVER_VERBOSE === "1";
}

export async function runDaemon(opts: { workspace: string; verbose?: boolean }): Promise<void> {
  const wsResult = validateWorkspace(opts.workspace, new NodeFileSystem());
  if (!wsResult.ok) {
    process.stdout.write(
      `${JSON.stringify({ status: "error", error: "VALIDATION_ERROR", message: wsResult.error })}\n`,
    );
    process.exit(1);
  }
  const absWorkspace = wsResult.workspace;
  const verbose = resolveVerbose(opts);

  ensureCacheDir();

  const sockPath = socketPath(absWorkspace);
  const pidPath = lockfilePath(absWorkspace);
  const logger = verbose ? createLogger(absWorkspace) : null;

  removeDaemonFiles(absWorkspace);

  const nodeFs = new NodeFileSystem();
  const host: DaemonHost = {
    onSignal: (signal, handler) => process.on(signal, handler),
    exit: (code) => process.exit(code),
  };

  // Serialise all incoming requests with a promise-chain mutex so that
  // concurrent connections never interleave file writes.
  let queue: Promise<void> = Promise.resolve();

  await runLifecycle({
    sockPath,
    pidPath,
    pid: process.pid,
    fs: nodeFs,
    host,
    startServer: () => {
      const server = net.createServer((socket) => {
        let buf = "";
        socket.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) {
              const trimmed = line.trim();
              queue = queue.then(() => handleSocketRequest(socket, trimmed, absWorkspace, logger));
            }
          }
        });
        socket.on("error", (err) => {
          if (logger) {
            const code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
            logger.log({
              ts: new Date().toISOString(),
              method: "socket.error",
              durationMs: 0,
              status: "error",
              error: code,
              message: err.message,
            });
          }
        });
      });
      return server;
    },
    startWatcher: () => {
      // Watch VUE_EXTENSIONS unconditionally rather than choosing based on the
      // project's structure at startup: a TS-only project that gains its first
      // .vue file mid-session needs edits to that file observed too, and engine
      // selection (see resetDiscoveryCaches) is already re-evaluated per dispatch
      // regardless of what the watcher reports.
      return startWatcher(absWorkspace, VUE_EXTENSIONS, {
        onFileChanged: invalidateFile,
        onFileAdded: invalidateAll,
        onFileRemoved: invalidateAll,
      });
    },
    signalReady: () => {
      process.stderr.write(`${JSON.stringify({ status: "ready", workspace: absWorkspace })}\n`);
    },
    logger: logger ?? undefined,
  });
}

const RequestEnvelopeSchema = z.object({
  method: z.string().min(1, "method is required"),
  params: z.record(z.string(), z.unknown()).default({}),
});

/** Write operations that return a filesModified count in their response. */
const WRITE_METHODS = new Set([
  "rename",
  "moveFile",
  "moveDirectory",
  "moveSymbol",
  "extractFunction",
  "deleteFile",
  "replaceText",
]);

/** Parse a socket line as JSON, isolating the one throw source in the request path. */
function parseLine(line: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function handleSocketRequest(
  socket: net.Socket,
  line: string,
  workspace: string,
  logger: DaemonLogger | null,
): Promise<void> {
  const start = Date.now();
  let method = "unknown";
  let response: DispatchResponse | { status: "success"; buildId: number };

  const parsed = parseLine(line);
  if (!parsed.ok) {
    response = { status: "error", error: "PARSE_ERROR", message: parsed.message };
  } else {
    const envelope = RequestEnvelopeSchema.safeParse(parsed.value);
    if (!envelope.success) {
      const message = envelope.error.issues.map((i) => i.message).join("; ");
      response = { status: "error", error: "PARSE_ERROR", message };
    } else {
      method = envelope.data.method;
      response =
        method === "ping"
          ? { status: "success", buildId: RUNNING_BUILD_ID }
          : await dispatchRequest(envelope.data, workspace);
    }
  }

  socket.write(`${JSON.stringify(response)}\n`);

  if (logger && method !== "ping") {
    const durationMs = Date.now() - start;
    const res = response as Record<string, unknown>;
    const status =
      typeof res.status === "string" ? (res.status as "success" | "warn" | "error") : "error";
    const entry: import("./logger.js").LogEntry = {
      ts: new Date().toISOString(),
      method,
      durationMs,
      status,
    };

    if (status === "error") {
      if (typeof res.error === "string") entry.error = res.error;
      if (typeof res.message === "string") entry.message = res.message;
      if (typeof res.stack === "string") entry.stack = res.stack;
    }

    if (status !== "error" && WRITE_METHODS.has(method)) {
      const modified = res.filesModified;
      if (Array.isArray(modified)) {
        entry.filesModified = modified.length;
      } else if (typeof modified === "number") {
        entry.filesModified = modified;
      }
    }

    logger.log(entry);
  }
}
