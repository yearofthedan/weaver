import * as fs from "node:fs";
import { logfilePath } from "./paths.js";

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

export interface LogEntry {
  ts: string;
  method: string;
  durationMs: number;
  status: "success" | "warn" | "error";
  error?: string;
  message?: string;
  filesModified?: number;
  stack?: string;
}

export interface DaemonLogger {
  log(entry: LogEntry): void;
  cleanup(): void;
  readonly logPath: string;
}

/**
 * Strip the workspace prefix from absolute paths in stack traces so that
 * logs are portable and don't leak the full host path.
 */
export function stripWorkspacePrefix(stack: string, workspace: string): string {
  const prefix = workspace.endsWith("/") ? workspace : `${workspace}/`;
  return stack.replaceAll(prefix, "");
}

export function createLogger(workspace: string): DaemonLogger {
  const logPath = logfilePath(workspace);
  const fd = fs.openSync(logPath, "w", 0o600);

  return {
    logPath,

    log(entry: LogEntry): void {
      const line = `${JSON.stringify(entry)}\n`;
      fs.appendFileSync(fd, line);

      try {
        const stat = fs.fstatSync(fd);
        if (stat.size > MAX_LOG_SIZE) {
          truncateFromHead(logPath, fd, stat.size);
        }
      } catch {
        // stat failure is non-fatal
      }
    },

    cleanup(): void {
      try {
        fs.closeSync(fd);
      } catch {
        // already closed
      }
      try {
        fs.unlinkSync(logPath);
      } catch {
        // already gone
      }
    },
  };
}

/**
 * Truncate the log file from the head, keeping roughly the last half.
 * Reads the file, finds the first newline after the halfway point, and
 * rewrites from there.
 */
function truncateFromHead(logPath: string, fd: number, currentSize: number): void {
  try {
    const content = fs.readFileSync(logPath, "utf8");
    const halfway = Math.floor(currentSize / 2);
    const nextNewline = content.indexOf("\n", halfway);
    if (nextNewline === -1) return;
    const trimmed = content.slice(nextNewline + 1);
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, trimmed, 0);
  } catch {
    // truncation failure is non-fatal
  }
}
