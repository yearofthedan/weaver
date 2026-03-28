import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, stripWorkspacePrefix } from "./logger.js";
import { logfilePath } from "./paths.js";

const CACHE_DIR = path.join(os.homedir(), ".cache", "weaver");
const WORKSPACE_A = "/tmp/test-logger-workspace-a";
const WORKSPACE_B = "/tmp/test-logger-workspace-b";

describe("logfilePath", () => {
  it("returns a .log path inside the cache dir", () => {
    const p = logfilePath(WORKSPACE_A);
    expect(p).toMatch(/\.log$/);
    expect(p.startsWith(CACHE_DIR)).toBe(true);
  });

  it("is deterministic", () => {
    expect(logfilePath(WORKSPACE_A)).toBe(logfilePath(WORKSPACE_A));
  });

  it("different workspaces produce different paths", () => {
    expect(logfilePath(WORKSPACE_A)).not.toBe(logfilePath(WORKSPACE_B));
  });
});

describe("stripWorkspacePrefix", () => {
  it("removes workspace prefix from absolute paths", () => {
    const stack = "Error: boom\n  at /ws/project/src/foo.ts:10:5\n  at /ws/project/src/bar.ts:20:3";
    const result = stripWorkspacePrefix(stack, "/ws/project");
    expect(result).toBe("Error: boom\n  at src/foo.ts:10:5\n  at src/bar.ts:20:3");
  });

  it("handles workspace with trailing slash", () => {
    const stack = "at /ws/project/src/foo.ts:1:1";
    expect(stripWorkspacePrefix(stack, "/ws/project/")).toBe("at src/foo.ts:1:1");
  });

  it("returns unchanged string when prefix not present", () => {
    const stack = "at /other/path/foo.ts:1:1";
    expect(stripWorkspacePrefix(stack, "/ws/project")).toBe(stack);
  });
});

describe("createLogger", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lb-logger-"));
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.unlinkSync(logfilePath(workspace));
    } catch {
      // already gone
    }
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("creates a log file with mode 0o600", () => {
    const logger = createLogger(workspace);
    const stat = fs.statSync(logger.logPath);
    expect(stat.mode & 0o777).toBe(0o600);
    logger.cleanup();
  });

  it("writes structured JSON lines", () => {
    const logger = createLogger(workspace);
    logger.log({
      ts: "2026-03-21T00:00:00.000Z",
      method: "rename",
      durationMs: 42,
      status: "success",
      filesModified: 3,
    });
    logger.log({
      ts: "2026-03-21T00:00:01.000Z",
      method: "moveFile",
      durationMs: 100,
      status: "error",
      error: "PARSE_ERROR",
      message: "bad input",
    });

    const lines = fs.readFileSync(logger.logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first).toEqual({
      ts: "2026-03-21T00:00:00.000Z",
      method: "rename",
      durationMs: 42,
      status: "success",
      filesModified: 3,
    });
    expect(first).not.toHaveProperty("ok");

    const second = JSON.parse(lines[1]);
    expect(second).toMatchObject({ status: "error", error: "PARSE_ERROR", message: "bad input" });
    expect(second).not.toHaveProperty("ok");

    logger.cleanup();
  });

  it("cleanup removes the log file", () => {
    const logger = createLogger(workspace);
    logger.log({
      ts: "2026-03-21T00:00:00.000Z",
      method: "ping",
      durationMs: 1,
      status: "success",
    });
    expect(fs.existsSync(logger.logPath)).toBe(true);
    logger.cleanup();
    expect(fs.existsSync(logger.logPath)).toBe(false);
  });

  it("logPath matches logfilePath for the workspace", () => {
    const logger = createLogger(workspace);
    expect(logger.logPath).toBe(logfilePath(workspace));
    logger.cleanup();
  });
});
