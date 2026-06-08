import * as path from "node:path";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixtureTest as test } from "../../__testHelpers__/helpers.js";
import {
  killDaemon,
  runCliCommand,
  spawnAndWaitForReady,
} from "../../__testHelpers__/process-helpers.js";
import { removeDaemonFiles } from "../../daemon/daemon.js";
import {
  readStdin,
  registerOperationSubcommands,
  resolveInput,
  resolveRelativePaths,
  writeJsonError,
} from "./operations.js";

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

  it("rename subcommand help includes type labels", () => {
    const program = buildProgram();
    const help = captureHelp(findCmd(program, "rename"));
    expect(help).toContain("(string)");
    expect(help).toContain("(number)");
    expect(help).toContain("(boolean?)");
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

  it("get-type-errors subcommand help includes file param with optional marker", () => {
    const program = buildProgram();
    const help = captureHelp(findCmd(program, "get-type-errors"));
    expect(help).toContain("file");
    expect(help).toContain("string?");
    expect(help).toContain("Absolute path to a single .ts/.tsx file");
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

describe("resolveRelativePaths", () => {
  it("resolves relative path params to absolute using workspace", () => {
    const params: Record<string, unknown> = { file: "src/utils.ts", line: 1 };
    resolveRelativePaths(params, ["file"], "/workspace");
    expect(params.file).toBe(path.join("/workspace", "src/utils.ts"));
  });

  it("leaves absolute paths unchanged", () => {
    const params: Record<string, unknown> = { file: "/abs/src/utils.ts" };
    resolveRelativePaths(params, ["file"], "/workspace");
    expect(params.file).toBe("/abs/src/utils.ts");
  });

  it("leaves non-string params unchanged", () => {
    const params: Record<string, unknown> = { line: 42 };
    resolveRelativePaths(params, ["line"], "/workspace");
    expect(params.line).toBe(42);
  });

  it("resolves multiple path params in one call", () => {
    const params: Record<string, unknown> = {
      oldPath: "src/a.ts",
      newPath: "src/b.ts",
    };
    resolveRelativePaths(params, ["oldPath", "newPath"], "/workspace");
    expect(params.oldPath).toBe(path.join("/workspace", "src/a.ts"));
    expect(params.newPath).toBe(path.join("/workspace", "src/b.ts"));
  });

  it("ignores path params not present in params object", () => {
    const params: Record<string, unknown> = { file: "src/a.ts" };
    // 'extra' key not in params — should not throw
    resolveRelativePaths(params, ["file", "extra"], "/workspace");
    expect(params.file).toBe(path.join("/workspace", "src/a.ts"));
    expect(params.extra).toBeUndefined();
  });

  it("does not modify params when pathParams list is empty", () => {
    const params: Record<string, unknown> = { file: "src/a.ts" };
    resolveRelativePaths(params, [], "/workspace");
    expect(params.file).toBe("src/a.ts");
  });
});

describe("resolveInput", () => {
  it("returns the jsonArg directly when it is provided", async () => {
    const result = await resolveInput('{"file":"a.ts"}', "rename");
    expect(result).toBe('{"file":"a.ts"}');
  });

  it("reads stdin when jsonArg is undefined and stdin is not a TTY", async () => {
    const origIsTTY = process.stdin.isTTY;
    const origOn = process.stdin.on.bind(process.stdin);
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    const mockOn = (event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
      return process.stdin;
    };
    (process.stdin as NodeJS.ReadStream & { on: typeof mockOn }).on = mockOn;

    const promise = resolveInput(undefined, "rename");
    for (const cb of listeners.data ?? []) cb('{"file":"stdin.ts"}');
    for (const cb of listeners.end ?? []) cb();
    const result = await promise;

    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    (process.stdin as NodeJS.ReadStream & { on: typeof origOn }).on = origOn;

    expect(result).toBe('{"file":"stdin.ts"}');
  });
});

describe("readStdin", () => {
  it("accumulates data chunks and returns trimmed string on end", async () => {
    const origSetEncoding = process.stdin.setEncoding.bind(process.stdin);
    const origOn = process.stdin.on.bind(process.stdin);
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    const mockSetEncoding = () => process.stdin;
    const mockOn = (event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
      return process.stdin;
    };
    (process.stdin as NodeJS.ReadStream & { setEncoding: typeof mockSetEncoding }).setEncoding =
      mockSetEncoding;
    (process.stdin as NodeJS.ReadStream & { on: typeof mockOn }).on = mockOn;

    const promise = readStdin();
    for (const cb of listeners.data ?? []) cb("chunk1 ");
    for (const cb of listeners.data ?? []) cb("chunk2");
    for (const cb of listeners.end ?? []) cb();
    const result = await promise;

    process.stdin.setEncoding = origSetEncoding;
    (process.stdin as NodeJS.ReadStream & { on: typeof origOn }).on = origOn;

    expect(result).toBe("chunk1 chunk2");
  });

  it("trims leading and trailing whitespace from the accumulated buffer", async () => {
    const origSetEncoding = process.stdin.setEncoding.bind(process.stdin);
    const origOn = process.stdin.on.bind(process.stdin);
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    const mockSetEncoding = () => process.stdin;
    const mockOn = (event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
      return process.stdin;
    };
    (process.stdin as NodeJS.ReadStream & { setEncoding: typeof mockSetEncoding }).setEncoding =
      mockSetEncoding;
    (process.stdin as NodeJS.ReadStream & { on: typeof mockOn }).on = mockOn;

    const promise = readStdin();
    for (const cb of listeners.data ?? []) cb("  json content  \n");
    for (const cb of listeners.end ?? []) cb();
    const result = await promise;

    process.stdin.setEncoding = origSetEncoding;
    (process.stdin as NodeJS.ReadStream & { on: typeof origOn }).on = origOn;

    expect(result).toBe("json content");
  });
});

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

  it("rename --help lists JSON parameters with names, types, and descriptions, exits 0", async () => {
    const { exitCode, stdout } = await runCliCommand(["rename", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("VALIDATION_ERROR");
    // Each parameter name must be listed
    expect(stdout).toContain("file");
    expect(stdout).toContain("line");
    expect(stdout).toContain("col");
    expect(stdout).toContain("newName");
    expect(stdout).toContain("checkTypeErrors");
    // Descriptions must be present (sourced from schema.ts)
    expect(stdout).toContain("Absolute path to the file");
    expect(stdout).toContain("Line number (1-based)");
    expect(stdout).toContain("New name for the symbol");
    expect(stdout).toContain("When false, skip the post-write type check");
    // Type labels must be present
    expect(stdout).toContain("string");
    expect(stdout).toContain("number");
    expect(stdout).toContain("boolean?");
    // --workspace is still listed
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
