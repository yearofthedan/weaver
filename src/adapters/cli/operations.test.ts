import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES, readFile } from "../../__testHelpers__/helpers.js";
import {
  killDaemon,
  runCliCommand,
  spawnAndWaitForReady,
} from "../../__testHelpers__/process-helpers.js";
import { removeDaemonFiles } from "../../daemon/daemon.js";

describe("CLI help and version", () => {
  it("--help exits 0 with no JSON error", async () => {
    const { exitCode, stdout } = await runCliCommand(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("weaver");
    expect(stdout).not.toContain("VALIDATION_ERROR");
  });

  it("--version exits 0", async () => {
    const { exitCode, stdout } = await runCliCommand(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("CLI operation subcommands", () => {
  const dirs: string[] = [];
  const procs: import("node:child_process").ChildProcess[] = [];

  afterEach(() => {
    for (const proc of procs.splice(0)) {
      if (!proc.killed) proc.kill();
    }
    for (const dir of dirs.splice(0)) {
      killDaemon(dir);
      removeDaemonFiles(dir);
      cleanup(dir);
    }
  });

  it("renames a symbol end-to-end, prints JSON to stdout, exits 0", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const daemon = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(daemon);

    const params = JSON.stringify({
      file: path.join(dir, "src/utils.ts"),
      line: 1,
      col: 17,
      newName: "greetPerson",
    });

    const { exitCode, stdout } = await runCliCommand(
      ["rename", "--workspace", dir, params],
      15_000,
    );

    const response = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(response.status).toBe("success");
    expect(exitCode).toBe(0);
    expect(readFile(dir, "src/utils.ts")).toContain("greetPerson");
    expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
  }, 60_000);

  it("resolves relative paths against --workspace", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const daemon = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(daemon);

    const params = JSON.stringify({
      file: "src/utils.ts",
      line: 1,
      col: 17,
      newName: "greetPerson",
    });

    const { exitCode, stdout } = await runCliCommand(
      ["rename", "--workspace", dir, params],
      15_000,
    );

    const response = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(response.status).toBe("success");
    expect(exitCode).toBe(0);
  }, 60_000);

  it("exits 1 and prints error status when the daemon returns an error", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const daemon = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(daemon);

    const params = JSON.stringify({
      file: path.join(dir, "src/utils.ts"),
      line: 99,
      col: 1,
      newName: "anything",
    });

    const { exitCode, stdout } = await runCliCommand(
      ["rename", "--workspace", dir, params],
      15_000,
    );

    const response = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(response.status).toBe("error");
    expect(exitCode).toBe(1);
  }, 60_000);

  it("prints VALIDATION_ERROR and exits 1 for invalid JSON", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const daemon = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(daemon);

    const { exitCode, stdout } = await runCliCommand(
      ["rename", "--workspace", dir, "not-json{"],
      15_000,
    );

    const response = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(response.status).toBe("error");
    expect(response.error).toBe("VALIDATION_ERROR");
    expect(response.message).toContain("Invalid JSON");
    expect(exitCode).toBe(1);
  }, 60_000);

  it("prints VALIDATION_ERROR and exits 1 when stdin is empty (no JSON)", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    // runCliCommand uses stdin: "ignore" — child gets an immediately-closed fd,
    // so readStdin() returns "" which fails JSON.parse
    const { exitCode, stdout } = await runCliCommand(["rename", "--workspace", dir], 15_000);

    const response = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(response.status).toBe("error");
    expect(response.error).toBe("VALIDATION_ERROR");
    expect(exitCode).toBe(1);
  }, 60_000);
});
