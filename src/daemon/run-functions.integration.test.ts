/**
 * Direct in-process tests for runStop and runDaemon.
 *
 * These functions are process-entry-points that write to stdout and call
 * process.exit on failure. We mock those two side-effects so the function
 * body runs in the test process (adding coverage), while keeping the test
 * hermetic. The happy paths never call process.exit, so no mock is needed
 * for them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../__testHelpers__/helpers.js";
import { isDaemonAlive, removeDaemonFiles, runDaemon, runStop } from "./daemon.js";
import { killDaemon, spawnAndWaitForReady } from "../__testHelpers__/process-helpers.js";

// ─── runStop ─────────────────────────────────────────────────────────────────

describe("runStop", () => {
  const dirs: string[] = [];
  const procs: import("node:child_process").ChildProcess[] = [];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const proc of procs.splice(0)) {
      if (!proc.killed) proc.kill();
    }
    for (const dir of dirs.splice(0)) {
      killDaemon(dir);
      removeDaemonFiles(dir);
      cleanup(dir);
    }
  });

  it("writes VALIDATION_ERROR and exits 1 when workspace does not exist", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("EXIT");
    }) as () => never);

    await expect(runStop({ workspace: "/nonexistent/path/xyz_test_abc" })).rejects.toThrow("EXIT");

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain('"VALIDATION_ERROR"');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("writes stopped:false and returns when no daemon is running", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    await runStop({ workspace: dir });

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain('"stopped":false');
  });

  it("sends SIGTERM, waits, and writes stopped:true when daemon is running", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    expect(isDaemonAlive(dir)).toBe(true);
    await runStop({ workspace: dir });

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain('"stopped":true');
    expect(isDaemonAlive(dir)).toBe(false);
  }, 15_000);
});

// ─── runDaemon ───────────────────────────────────────────────────────────────

describe("runDaemon validation", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes VALIDATION_ERROR and exits 1 when workspace does not exist", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("EXIT");
    }) as () => never);

    await expect(runDaemon({ workspace: "/nonexistent/path/xyz_test_abc" })).rejects.toThrow(
      "EXIT",
    );

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain('"VALIDATION_ERROR"');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
