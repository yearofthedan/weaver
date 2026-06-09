import type { ChildProcess } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../../__testHelpers__/helpers.js";
import {
  killDaemon,
  runCliCommand,
  spawnAndWaitForReady,
} from "../../__testHelpers__/process-helpers.js";
import { removeDaemonFiles } from "../../daemon/daemon.js";

describe("CLI transport — workspace security", () => {
  const procs: ChildProcess[] = [];
  test.afterEach(({ dir }) => {
    for (const proc of procs.splice(0)) {
      if (!proc.killed) proc.kill();
    }
    killDaemon(dir);
    removeDaemonFiles(dir);
  });

  test("rename rejects a file path outside the workspace", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const daemon = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(daemon);

    const params = JSON.stringify({
      file: path.join(os.tmpdir(), "outside.ts"),
      line: 1,
      col: 1,
      newName: "hacked",
    });

    const { exitCode, stdout } = await runCliCommand(
      ["rename", "--workspace", dir, params],
      15_000,
    );

    const response = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(response.status).toBe("error");
    expect(response.error).toBe("WORKSPACE_VIOLATION");
    expect(exitCode).toBe(1);
  }, 60_000);

  test("move-file rejects oldPath outside the workspace", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const daemon = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(daemon);

    const params = JSON.stringify({
      oldPath: path.join(os.tmpdir(), "outside.ts"),
      newPath: path.join(dir, "src/inside.ts"),
    });

    const { exitCode, stdout } = await runCliCommand(
      ["move-file", "--workspace", dir, params],
      15_000,
    );

    const response = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(response.status).toBe("error");
    expect(response.error).toBe("WORKSPACE_VIOLATION");
    expect(exitCode).toBe(1);
  }, 60_000);

  test("move-file rejects newPath outside the workspace", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const daemon = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(daemon);

    const params = JSON.stringify({
      oldPath: path.join(dir, "src/utils.ts"),
      newPath: path.join(os.tmpdir(), "stolen.ts"),
    });

    const { exitCode, stdout } = await runCliCommand(
      ["move-file", "--workspace", dir, params],
      15_000,
    );

    const response = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(response.status).toBe("error");
    expect(response.error).toBe("WORKSPACE_VIOLATION");
    expect(exitCode).toBe(1);
  }, 60_000);

  test("rename rejects a relative-segment path that traverses outside the workspace", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const daemon = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(daemon);

    // A path that starts within the workspace dir but escapes via ../../../
    const traversal = path.join(dir, "src", "..", "..", "..", "etc", "passwd");

    const params = JSON.stringify({
      file: traversal,
      line: 1,
      col: 1,
      newName: "hacked",
    });

    const { exitCode, stdout } = await runCliCommand(
      ["rename", "--workspace", dir, params],
      15_000,
    );

    const response = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(response.status).toBe("error");
    expect(response.error).toBe("WORKSPACE_VIOLATION");
    expect(exitCode).toBe(1);
  }, 60_000);

  test("rename rejects newName that is not a valid identifier", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const daemon = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(daemon);

    const params = JSON.stringify({
      file: path.join(dir, "src/utils.ts"),
      line: 1,
      col: 17,
      newName: "not-valid!",
    });

    const { exitCode, stdout } = await runCliCommand(
      ["rename", "--workspace", dir, params],
      15_000,
    );

    const response = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(response.status).toBe("error");
    // The daemon's Zod schema rejects non-identifier newName values
    expect(response.error).toBeTruthy();
    expect(exitCode).toBe(1);
  }, 60_000);

  test("newline embedded in a file path does not inject a second daemon command", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const daemon = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(daemon);

    // JSON.stringify escapes the embedded newline as the two-char sequence \n,
    // so the daemon receives one well-formed request line — not two separate
    // commands. This guards against socket-framing injection.
    const params = JSON.stringify({
      file: `${path.join(dir, "src/utils.ts")}\n{"method":"ping"}`,
      line: 1,
      col: 1,
      newName: "safe",
    });

    const { stdout: errStdout } = await runCliCommand(
      ["rename", "--workspace", dir, params],
      15_000,
    );

    const errorResponse = JSON.parse(errStdout.trim()) as Record<string, unknown>;
    // The injected \n is escaped; daemon receives a single request and returns
    // exactly one error (WORKSPACE_VIOLATION or INVALID_PATH — either proves
    // the newline was not treated as a command separator).
    expect(errorResponse.status).toBe("error");

    // Daemon is still alive and responsive after the injection attempt.
    const followUpParams = JSON.stringify({
      file: path.join(dir, "src/utils.ts"),
      line: 1,
      col: 17,
      newName: "greetPerson",
    });

    const { exitCode: followUpExit, stdout: followUpStdout } = await runCliCommand(
      ["rename", "--workspace", dir, followUpParams],
      15_000,
    );

    const followUpResponse = JSON.parse(followUpStdout.trim()) as Record<string, unknown>;
    expect(followUpResponse.status).toBe("success");
    expect(followUpExit).toBe(0);
  }, 60_000);
});
