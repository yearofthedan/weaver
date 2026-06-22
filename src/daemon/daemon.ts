import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { z } from "zod";
import { EngineError } from "../domain/errors.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TS_EXTENSIONS, VUE_EXTENSIONS } from "../utils/extensions.js";
import { findTsConfigForFile, isVueProject } from "../utils/ts-project.js";
import { dispatchRequest, invalidateAll, invalidateFile } from "./dispatcher.js";
import type { DaemonHost } from "./lifecycle.js";
import { runLifecycle } from "./lifecycle.js";
import type { DaemonLogger } from "./logger.js";
import { createLogger, stripWorkspacePrefix } from "./logger.js";
import { ensureCacheDir, lockfilePath, socketPath } from "./paths.js";
import { validateWorkspace } from "./validate-workspace.js";
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
      const sentinelPath = path.join(absWorkspace, "__sentinel__");
      const tsConfigPath = findTsConfigForFile(sentinelPath);
      const watchExtensions =
        tsConfigPath && isVueProject(tsConfigPath) ? VUE_EXTENSIONS : TS_EXTENSIONS;
      return startWatcher(absWorkspace, watchExtensions, {
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

async function handleSocketRequest(
  socket: net.Socket,
  line: string,
  workspace: string,
  logger: DaemonLogger | null,
): Promise<void> {
  const start = Date.now();
  let method = "unknown";
  let response: object;
  let caughtError: unknown = null;

  try {
    const raw: unknown = JSON.parse(line);
    const envelope = RequestEnvelopeSchema.safeParse(raw);
    if (!envelope.success) {
      const message = envelope.error.issues.map((i) => i.message).join("; ");
      response = { status: "error" as const, error: "PARSE_ERROR", message };
    } else {
      method = envelope.data.method;
      if (method === "ping") {
        response = { status: "success" as const, version: PROTOCOL_VERSION };
      } else {
        response = await dispatchRequest(envelope.data, workspace);
      }
    }
  } catch (err) {
    caughtError = err;
    response = {
      status: "error" as const,
      error: EngineError.is(err)
        ? err.code
        : err instanceof SyntaxError
          ? "PARSE_ERROR"
          : "INTERNAL_ERROR",
      message: err instanceof Error ? err.message : String(err),
    };
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
    }

    if (status !== "error" && WRITE_METHODS.has(method)) {
      const modified = res.filesModified;
      if (Array.isArray(modified)) {
        entry.filesModified = modified.length;
      } else if (typeof modified === "number") {
        entry.filesModified = modified;
      }
    }

    if (caughtError instanceof Error && caughtError.stack) {
      entry.stack = stripWorkspacePrefix(caughtError.stack, workspace);
    }

    logger.log(entry);
  }
}
