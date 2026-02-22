import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDaemonAlive, removeDaemonFiles } from "../../src/daemon/daemon";
import { lockfilePath, socketPath } from "../../src/daemon/paths";

const WORKSPACE_A = "/tmp/test-workspace-alpha";
const WORKSPACE_B = "/tmp/test-workspace-beta";
const CACHE_DIR = path.join(os.homedir(), ".cache", "light-bridge");

describe("socketPath / lockfilePath", () => {
  it("returns a .sock path inside the cache dir", () => {
    const p = socketPath(WORKSPACE_A);
    expect(p).toMatch(/\.sock$/);
    expect(p.startsWith(CACHE_DIR)).toBe(true);
  });

  it("returns a .pid path inside the cache dir", () => {
    const p = lockfilePath(WORKSPACE_A);
    expect(p).toMatch(/\.pid$/);
    expect(p.startsWith(CACHE_DIR)).toBe(true);
  });

  it("is deterministic — same workspace → same path", () => {
    expect(socketPath(WORKSPACE_A)).toBe(socketPath(WORKSPACE_A));
    expect(lockfilePath(WORKSPACE_A)).toBe(lockfilePath(WORKSPACE_A));
  });

  it("different workspaces → different paths", () => {
    expect(socketPath(WORKSPACE_A)).not.toBe(socketPath(WORKSPACE_B));
    expect(lockfilePath(WORKSPACE_A)).not.toBe(lockfilePath(WORKSPACE_B));
  });

  it("socket and lockfile paths are different for the same workspace", () => {
    expect(socketPath(WORKSPACE_A)).not.toBe(lockfilePath(WORKSPACE_A));
  });
});

describe("isDaemonAlive", () => {
  const testWorkspace = "/tmp/test-daemon-alive-workspace";

  beforeEach(() => {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    // Clean up any leftover files
    removeDaemonFiles(testWorkspace);
  });

  afterEach(() => {
    removeDaemonFiles(testWorkspace);
  });

  it("returns false when no lockfile exists", () => {
    expect(isDaemonAlive(testWorkspace)).toBe(false);
  });

  it("returns false when lockfile contains a non-numeric value", () => {
    fs.writeFileSync(lockfilePath(testWorkspace), "not-a-pid");
    expect(isDaemonAlive(testWorkspace)).toBe(false);
  });

  it("returns false when lockfile contains a non-existent PID", () => {
    // PID 999999999 is extremely unlikely to exist
    fs.writeFileSync(lockfilePath(testWorkspace), "999999999");
    expect(isDaemonAlive(testWorkspace)).toBe(false);
  });

  it("returns true when lockfile contains the current process PID", () => {
    fs.writeFileSync(lockfilePath(testWorkspace), String(process.pid));
    expect(isDaemonAlive(testWorkspace)).toBe(true);
  });
});

describe("removeDaemonFiles", () => {
  const testWorkspace = "/tmp/test-daemon-remove-workspace";

  beforeEach(() => {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  });

  afterEach(() => {
    removeDaemonFiles(testWorkspace);
  });

  it("removes socket and lockfile when they exist", () => {
    fs.writeFileSync(socketPath(testWorkspace), "");
    fs.writeFileSync(lockfilePath(testWorkspace), "");
    removeDaemonFiles(testWorkspace);
    expect(fs.existsSync(socketPath(testWorkspace))).toBe(false);
    expect(fs.existsSync(lockfilePath(testWorkspace))).toBe(false);
  });

  it("does not throw when files do not exist", () => {
    expect(() => removeDaemonFiles(testWorkspace)).not.toThrow();
  });
});
