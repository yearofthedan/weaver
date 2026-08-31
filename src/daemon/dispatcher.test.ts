import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { dispatchRequest, makeRegistry } from "./dispatcher.js";

const mockMoveFile = vi.hoisted(() =>
  vi.fn<typeof import("../operations/moveFile.js")["moveFile"]>(),
);

vi.mock("../operations/moveFile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../operations/moveFile.js")>();
  mockMoveFile.mockImplementation(actual.moveFile);
  return {
    moveFile: (...args: Parameters<typeof actual.moveFile>) => mockMoveFile(...args),
  };
});

describe("makeRegistry", () => {
  it("returns an object with a projectEngine function", () => {
    const registry = makeRegistry("/any/file.ts", "/any");
    expect(typeof registry.projectEngine).toBe("function");
  });

  test("projectEngine resolves to a TsMorphEngine for a TS-only project", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const registry = makeRegistry(path.join(dir, "src/utils.ts"), dir);
    const engine = await registry.projectEngine();
    expect(engine).toBeInstanceOf(TsMorphEngine);
  }, 10_000);
});

describe("dispatchRequest param validation", () => {
  const workspace = "/tmp/test-workspace";

  it.each([
    [
      "rename with line as string",
      {
        method: "rename",
        params: { file: "/tmp/test-workspace/a.ts", line: "five", col: 1, newName: "foo" },
      },
    ],
    [
      "rename missing required params",
      { method: "rename", params: { file: "/tmp/test-workspace/a.ts" } },
    ],
    ["searchText with pattern as number", { method: "searchText", params: { pattern: 123 } }],
    [
      "findReferences with col as null",
      {
        method: "findReferences",
        params: { file: "/tmp/test-workspace/a.ts", line: 1, col: null },
      },
    ],
    [
      "replaceText with both pattern and edits",
      {
        method: "replaceText",
        params: {
          pattern: "foo",
          replacement: "bar",
          edits: [
            { file: "/tmp/test-workspace/a.ts", line: 1, col: 1, oldText: "x", newText: "y" },
          ],
        },
      },
    ],
    ["replaceText with neither pattern nor edits", { method: "replaceText", params: {} }],
  ])("returns VALIDATION_ERROR — %s", async (_desc, request) => {
    const result = await dispatchRequest(request, workspace);
    expect(result).toMatchObject({ status: "error", error: "VALIDATION_ERROR" });
  });

  it("VALIDATION_ERROR message reports the real Zod issues, not a blank list", async () => {
    const result = (await dispatchRequest(
      { method: "rename", params: { file: "/tmp/test-workspace/a.ts" } },
      workspace,
    )) as Record<string, unknown>;
    expect(result.message).toContain("expected number, received NaN");
  });

  it("returns UNKNOWN_METHOD for an unrecognised method", async () => {
    const result = await dispatchRequest({ method: "doSomethingFake", params: {} }, workspace);
    expect(result).toMatchObject({ status: "error", error: "UNKNOWN_METHOD" });
  });
});

describe("dispatchRequest success format", () => {
  it("returns status:success and result fields without an ok or message field", async () => {
    // searchText on a pattern that matches nothing is the cheapest operation to invoke
    const result = (await dispatchRequest(
      { method: "searchText", params: { pattern: "__nonexistent_pattern_xyz__" } },
      "/tmp",
    )) as Record<string, unknown>;
    expect(result.status).toBe("success");
    expect(result).not.toHaveProperty("ok");
    expect(result).toHaveProperty("matches");
    expect(result).toHaveProperty("truncated");
    expect(result).not.toHaveProperty("message");
  });
});

describe("dispatchRequest per-operation dispatch", () => {
  test("dispatches getTypeErrors and returns diagnostics shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const result = (await dispatchRequest({ method: "getTypeErrors", params: {} }, dir)) as Record<
      string,
      unknown
    >;
    expect(result.status).toBe("success");
    expect(result).toHaveProperty("diagnostics");
    expect(result).toHaveProperty("errorCount");
    expect(result).toHaveProperty("truncated");
  }, 15_000);

  // Kept deliberately alongside the operation-level cases in getTypeErrors.test.ts, which cover
  // the same guard. Those build the engine by hand, so they only pin the behaviour for as long as
  // that construction stays right; this one goes through the registry and cannot drift. Dropping
  // it because the branch looks covered puts the file back where the bug hid.
  test("wires a project-wide getTypeErrors through the registry against a workspace holding an excluded JS file", async ({
    seedInlineFixture,
  }) => {
    const dir = await seedInlineFixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true },
        include: ["src"],
      }),
      "src/main.ts": "export const value: number = 1;",
      "jest.config.js": "module.exports = { testEnvironment: 'node' };",
    });

    const result = (await dispatchRequest({ method: "getTypeErrors", params: {} }, dir)) as Record<
      string,
      unknown
    >;

    expect(result.status).toBe("success");
    expect(result.errorCount).toBe(0);
    expect(result.diagnostics).toEqual([]);
  }, 15_000);

  test("dispatches findReferences and returns references shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const file = path.join(dir, "src/clean.ts");
    const result = (await dispatchRequest(
      { method: "findReferences", params: { file, line: 1, col: 17 } },
      dir,
    )) as Record<string, unknown>;
    expect(result.status).toBe("success");
    expect(result).toHaveProperty("references");
  }, 15_000);

  test("dispatches getDefinition and returns definition shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const file = path.join(dir, "src/clean.ts");
    const result = (await dispatchRequest(
      { method: "getDefinition", params: { file, line: 1, col: 17 } },
      dir,
    )) as Record<string, unknown>;
    expect(result.status).toBe("success");
    expect(result).toHaveProperty("definitions");
  }, 15_000);

  test("dispatches rename and returns result shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const file = path.join(dir, "src/clean.ts");
    const result = (await dispatchRequest(
      { method: "rename", params: { file, line: 1, col: 17, newName: "multiplied" } },
      dir,
    )) as Record<string, unknown>;
    expect(result.status).toBe("success");
    expect(result).toHaveProperty("filesModified");
  }, 15_000);

  test("dispatches moveFile and returns result shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const oldPath = path.join(dir, "src/clean.ts");
    const newPath = path.join(dir, "src/relocated.ts");
    const result = (await dispatchRequest(
      { method: "moveFile", params: { oldPath, newPath } },
      dir,
    )) as Record<string, unknown>;
    expect(result.status).toBe("success");
    expect(result).toHaveProperty("filesModified");
  }, 15_000);

  test("dispatches moveSymbol and returns result shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const sourceFile = path.join(dir, "src/clean.ts");
    const destFile = path.join(dir, "src/multiply.ts");
    const result = (await dispatchRequest(
      { method: "moveSymbol", params: { sourceFile, symbolName: "multiply", destFile } },
      dir,
    )) as Record<string, unknown>;
    expect(result.status).toBe("success");
    expect(result).toHaveProperty("filesModified");
  }, 15_000);

  test("dispatches moveDirectory and returns result shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.moveDirTs.name);
    const oldPath = path.join(dir, "src/utils");
    const newPath = path.join(dir, "src/lib");
    const result = (await dispatchRequest(
      { method: "moveDirectory", params: { oldPath, newPath } },
      dir,
    )) as Record<string, unknown>;
    expect(result.status).toBe("success");
    expect(result).toHaveProperty("filesMoved");
    expect(result).toHaveProperty("filesModified");
  }, 15_000);

  test("dispatches extractFunction and returns result shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const file = path.join(dir, "src/utils.ts");
    const result = (await dispatchRequest(
      {
        method: "extractFunction",
        params: { file, startLine: 2, startCol: 3, endLine: 2, endCol: 26, functionName: "greet" },
      },
      dir,
    )) as Record<string, unknown>;
    expect(result.status).toBe("success");
    expect(result).toHaveProperty("functionName", "greet");
    expect(result).toHaveProperty("filesModified");
  }, 15_000);

  test("dispatches findImporters and returns result shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.multiImporter.name);
    const file = path.join(dir, "src/utils.ts");
    const result = (await dispatchRequest(
      { method: "findImporters", params: { file } },
      dir,
    )) as Record<string, unknown>;
    expect(result.status).toBe("success");
    expect(result).toHaveProperty("fileName", "utils.ts");
    expect((result.references as unknown[]).length).toBe(2);
  }, 15_000);

  test("dispatches deleteFile and returns result shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.deleteFileTs.name);
    const file = path.join(dir, "src/target.ts");
    const result = (await dispatchRequest(
      { method: "deleteFile", params: { file } },
      dir,
    )) as Record<string, unknown>;
    // importer.ts still uses the now-removed targetFn/TargetType, so this
    // surfaces as a warn with type errors rather than a clean success.
    expect(result.status).toBe("warn");
    expect(result).toHaveProperty("deletedFile", file);
    expect(result).toHaveProperty("importRefsRemoved");
  }, 15_000);
});

describe("dispatchRequest moveSymbol force option", () => {
  const TSCONFIG = JSON.stringify({ compilerOptions: { strict: true }, include: ["**/*.ts"] });

  test("without force, a same-named symbol already in destFile is rejected", async ({
    seedInlineFixture,
  }) => {
    const dir = await seedInlineFixture({
      "tsconfig.json": TSCONFIG,
      "src/source.ts": "export function Foo(): void {}\n",
      "src/dest.ts": "export function Foo(): void {}\n",
    });
    const sourceFile = path.join(dir, "src/source.ts");
    const destFile = path.join(dir, "src/dest.ts");

    const result = (await dispatchRequest(
      { method: "moveSymbol", params: { sourceFile, symbolName: "Foo", destFile } },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("error");
    expect(result.error).toBe("SYMBOL_EXISTS");
  });

  test("with force:true, a same-named symbol already in destFile is replaced", async ({
    seedInlineFixture,
  }) => {
    const dir = await seedInlineFixture({
      "tsconfig.json": TSCONFIG,
      "src/source.ts": "export function Foo(): void {}\n",
      "src/dest.ts": "export function Foo(): void {}\n",
    });
    const sourceFile = path.join(dir, "src/source.ts");
    const destFile = path.join(dir, "src/dest.ts");

    const result = (await dispatchRequest(
      { method: "moveSymbol", params: { sourceFile, symbolName: "Foo", destFile, force: true } },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    expect(result).toHaveProperty("filesModified");
  });
});

describe("dispatchRequest searchText options", () => {
  test("passes context through and includes surrounding lines in the response", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);

    const withoutContext = (await dispatchRequest(
      { method: "searchText", params: { pattern: "greetUser", glob: "**/utils.ts" } },
      dir,
    )) as Record<string, unknown>;
    const withContext = (await dispatchRequest(
      {
        method: "searchText",
        params: { pattern: "greetUser", glob: "**/utils.ts", context: 1 },
      },
      dir,
    )) as Record<string, unknown>;

    const matchesWithoutContext = withoutContext.matches as Array<Record<string, unknown>>;
    const matchesWithContext = withContext.matches as Array<Record<string, unknown>>;
    expect(matchesWithoutContext[0]).not.toHaveProperty("surroundingText");
    expect(matchesWithContext[0].surroundingText).toContain("Hello");
  });
});

describe("dispatchRequest workspace boundary enforcement", () => {
  it("returns WORKSPACE_VIOLATION when a path param is outside the workspace", async () => {
    const result = (await dispatchRequest(
      {
        method: "rename",
        params: { file: "/outside-workspace/file.ts", line: 1, col: 1, newName: "x" },
      },
      "/tmp/workspace",
    )) as Record<string, unknown>;
    expect(result.status).toBe("error");
    expect(result.error).toBe("WORKSPACE_VIOLATION");
    expect(result).toHaveProperty("message");
  });
});

describe("dispatchRequest error responses", () => {
  it("resolves an EngineError thrown by an operation to a matching error response", async () => {
    const workspace = "/tmp/test-workspace";
    const file = `${workspace}/does-not-exist.ts`;

    const result = await dispatchRequest({ method: "getTypeErrors", params: { file } }, workspace);

    expect(result).toEqual({
      status: "error",
      error: "FILE_NOT_FOUND",
      message: `File not found: ${file}`,
    });
    expect(result).not.toHaveProperty("stack");
  });

  test("resolves an unexpected throw to an INTERNAL_ERROR response with a stack", async ({
    seedNamedFixture,
  }) => {
    mockMoveFile.mockImplementationOnce(() => {
      throw new TypeError("boom");
    });
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const oldPath = path.join(dir, "src/utils.ts");
    const newPath = path.join(dir, "src/moved.ts");

    const result = (await dispatchRequest(
      { method: "moveFile", params: { oldPath, newPath } },
      dir,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: "error",
      error: "INTERNAL_ERROR",
      message: "TypeError during 'moveFile': boom",
    });
    expect(typeof result.stack).toBe("string");
    expect((result.stack as string).length).toBeGreaterThan(0);
  });

  test("caps the returned stack at 10 frames, drops the message line, and strips the workspace prefix", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const frames = Array.from({ length: 15 }, (_, i) =>
      i < 3
        ? `    at fn (${dir}/src/utils.ts:${i + 1}:1)`
        : `    at fn (/other/place.js:${i + 1}:1)`,
    );
    const err = new TypeError("boom");
    err.stack = ["TypeError: boom", ...frames].join("\n");
    mockMoveFile.mockImplementationOnce(() => {
      throw err;
    });

    const oldPath = path.join(dir, "src/utils.ts");
    const newPath = path.join(dir, "src/moved.ts");
    const result = (await dispatchRequest(
      { method: "moveFile", params: { oldPath, newPath } },
      dir,
    )) as Record<string, unknown>;

    const stack = result.stack as string;
    const stackLines = stack.split("\n");
    expect(stack).not.toContain("TypeError: boom");
    expect(stackLines.length).toBeLessThanOrEqual(10);
    expect(stack).not.toContain(dir);
    expect(stackLines[0]).toBe("    at fn (src/utils.ts:1:1)");
  });

  test("resolves a thrown non-Error value to an INTERNAL_ERROR response with no stack", async ({
    seedNamedFixture,
  }) => {
    mockMoveFile.mockImplementationOnce(() => {
      throw "boom";
    });
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const oldPath = path.join(dir, "src/utils.ts");
    const newPath = path.join(dir, "src/moved.ts");

    const result = await dispatchRequest({ method: "moveFile", params: { oldPath, newPath } }, dir);

    expect(result).toEqual({ status: "error", error: "INTERNAL_ERROR", message: "boom" });
    expect(result).not.toHaveProperty("stack");
  });
});

describe("dispatchRequest path character validation", () => {
  it.each([
    ["null byte", "/tmp/workspace/foo\x00bar.ts"],
    ["newline", "/tmp/workspace/foo\nbar.ts"],
    ["unit separator (\\x1f)", "/tmp/workspace/foo\x1fbar.ts"],
  ])("returns INVALID_PATH and does not invoke the operation when file contains a control character — %s", async (_label, filePath) => {
    const result = (await dispatchRequest(
      {
        method: "rename",
        params: { file: filePath, line: 1, col: 1, newName: "x" },
      },
      "/tmp/workspace",
    )) as Record<string, unknown>;
    expect(result.status).toBe("error");
    expect(result.error).toBe("INVALID_PATH");
    expect(result.message).toBe("path contains control characters: file");
  });

  it.each([
    ["question mark (?)", "/tmp/workspace/src/foo.ts?v=1"],
    ["hash (#)", "/tmp/workspace/src/foo.ts#anchor"],
  ])("returns INVALID_PATH when file contains URI character — %s", async (_label, filePath) => {
    const result = (await dispatchRequest(
      { method: "rename", params: { file: filePath, line: 1, col: 1, newName: "x" } },
      "/tmp/workspace",
    )) as Record<string, unknown>;
    expect(result.status).toBe("error");
    expect(result.error).toBe("INVALID_PATH");
    expect(result.message).toContain("URI fragment or query character");
    expect(result.message).toContain("file");
  });
});
