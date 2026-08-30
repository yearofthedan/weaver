import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { FIXTURES, PROJECT_ROOT, fixtureTest as test } from "../../__testHelpers__/helpers.js";
import {
  killDaemon,
  runCliCommand,
  spawnAndWaitForReady,
} from "../../__testHelpers__/process-helpers.js";
import { removeDaemonFiles } from "../../daemon/daemon.js";
import { registerOperationSubcommands, writeJsonError } from "./operations.js";

describe("registerOperationSubcommands help rendering", () => {
  function buildProgram(): Command {
    const program = new Command();
    program.exitOverride();
    registerOperationSubcommands(program, (err) => {
      throw err;
    });
    return program;
  }

  function captureHelp(cmd: Command): string {
    let output = "";
    cmd.configureOutput({
      writeOut: (str) => {
        output += str;
      },
    });
    try {
      cmd.outputHelp();
    } catch {
      // exitOverride may throw for commander.helpDisplayed
    }
    return output;
  }

  function findCmd(program: Command, name: string): Command {
    const cmd = program.commands.find((c) => c.name() === name);
    if (!cmd) throw new Error(`Command ${name} not found`);
    return cmd;
  }

  it("rename subcommand help includes all field names", () => {
    const program = buildProgram();
    const help = captureHelp(findCmd(program, "rename"));
    expect(help).toContain("file");
    expect(help).toContain("line");
    expect(help).toContain("col");
    expect(help).toContain("newName");
    expect(help).toContain("checkTypeErrors");
  });

  it("rename subcommand help includes descriptions sourced from schema", () => {
    const program = buildProgram();
    const help = captureHelp(findCmd(program, "rename"));
    expect(help).toContain("Absolute path to the file");
    expect(help).toContain("Line number (1-based)");
    expect(help).toContain("New name for the symbol");
    expect(help).toContain("When false, skip the post-write type check");
  });

  it("rename subcommand help marks optional params and leaves required params unmarked", () => {
    const program = buildProgram();
    const help = captureHelp(findCmd(program, "rename"));
    expect(help).toContain("(optional) When false, skip the post-write type check");
    expect(help).not.toContain("(optional) Absolute path to the file");
  });

  it("rename subcommand help includes --workspace option", () => {
    const program = buildProgram();
    const help = captureHelp(findCmd(program, "rename"));
    expect(help).toContain("--workspace");
  });

  it("move-file subcommand help includes oldPath and newPath", () => {
    const program = buildProgram();
    const help = captureHelp(findCmd(program, "move-file"));
    expect(help).toContain("oldPath");
    expect(help).toContain("newPath");
    expect(help).toContain("Absolute path to the file to move");
    expect(help).toContain("Absolute destination path");
  });

  it("get-type-errors subcommand help marks its optional file param", () => {
    const program = buildProgram();
    const help = captureHelp(findCmd(program, "get-type-errors"));
    expect(help).toContain("file");
    expect(help).toContain("(optional) Absolute path to a single .ts/.tsx file");
  });

  it("all 12 subcommands are registered", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("rename");
    expect(names).toContain("move-file");
    expect(names).toContain("move-directory");
    expect(names).toContain("move-symbol");
    expect(names).toContain("extract-function");
    expect(names).toContain("find-importers");
    expect(names).toContain("find-references");
    expect(names).toContain("get-definition");
    expect(names).toContain("get-type-errors");
    expect(names).toContain("search-text");
    expect(names).toContain("delete-file");
    expect(names).toContain("replace-text");
    expect(names.length).toBe(12);
  });

  it("replace-text help includes edits field with surgical mode description", () => {
    const program = buildProgram();
    const help = captureHelp(findCmd(program, "replace-text"));
    expect(help).toContain("edits");
    expect(help).toContain("Surgical edits array");
  });
});

describe("writeJsonError", () => {
  it("writes a JSON error line to stdout", () => {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") chunks.push(chunk);
      return true;
    };
    try {
      writeJsonError("VALIDATION_ERROR", "bad input");
    } finally {
      process.stdout.write = orig;
    }
    expect(chunks).toHaveLength(1);
    const parsed = JSON.parse(chunks[0]) as Record<string, unknown>;
    expect(parsed.status).toBe("error");
    expect(parsed.error).toBe("VALIDATION_ERROR");
    expect(parsed.message).toBe("bad input");
  });

  it("output ends with a newline", () => {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") chunks.push(chunk);
      return true;
    };
    try {
      writeJsonError("INTERNAL_ERROR", "crash");
    } finally {
      process.stdout.write = orig;
    }
    expect(chunks[0]).toMatch(/\n$/);
  });
});

describe("CLI help and version", () => {
  it("--help exits 0 with no JSON error", async () => {
    const { exitCode, stdout } = await runCliCommand(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("weaver");
    expect(stdout).not.toContain("VALIDATION_ERROR");
  });

  it("--version exits 0 and reports the package.json version", async () => {
    const { exitCode, stdout } = await runCliCommand(["--version"]);
    const { version } = JSON.parse(
      readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"),
    ) as { version: string };
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(version);
  });

  it("rename --help renders the JSON parameter block through the real CLI and exits 0", async () => {
    const { exitCode, stdout } = await runCliCommand(["rename", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("VALIDATION_ERROR");
    // Smoke: the lazy param-help render fired end-to-end. Exhaustive
    // name/description/optional-marker coverage lives in the in-process unit
    // tests above; here we only prove the spawned binary wires and renders it.
    expect(stdout).toContain("JSON parameters:");
    expect(stdout).toContain("newName");
    expect(stdout).toContain("New name for the symbol");
    expect(stdout).toContain("--workspace");
  });
});

describe("CLI operation subcommands", () => {
  const procs: import("node:child_process").ChildProcess[] = [];
  test.afterEach(({ dir }) => {
    for (const proc of procs.splice(0)) {
      if (!proc.killed) proc.kill();
    }
    killDaemon(dir);
    removeDaemonFiles(dir);
  });

  test("renames a symbol end-to-end, prints JSON to stdout, exits 0", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
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
  }, 60_000);

  test("resolves relative paths against --workspace", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
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

  test("exits 1 and prints error status when the daemon returns an error", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
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

  test("prints VALIDATION_ERROR and exits 1 for invalid JSON", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
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

  test("prints VALIDATION_ERROR and exits 1 when stdin is empty (no JSON)", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    // runCliCommand uses stdin: "ignore" — child gets an immediately-closed fd,
    // so readStdin() returns "" which fails JSON.parse
    const { exitCode, stdout } = await runCliCommand(["rename", "--workspace", dir], 15_000);

    const response = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(response.status).toBe("error");
    expect(response.error).toBe("VALIDATION_ERROR");
    expect(exitCode).toBe(1);
  }, 60_000);
});
