import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { dispatchRequest, makeRegistry } from "./dispatcher.js";

describe("makeRegistry", () => {
  it("returns an object with projectEngine and tsEngine functions", () => {
    const registry = makeRegistry("/any/file.ts", "/any");
    expect(typeof registry.projectEngine).toBe("function");
    expect(typeof registry.tsEngine).toBe("function");
  });

  test("tsEngine resolves to a TsMorphEngine with Engine methods", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const registry = makeRegistry(path.join(dir, "src/utils.ts"), dir);
    const engine = await registry.tsEngine();
    expect(engine).toBeInstanceOf(TsMorphEngine);
    expect(typeof engine.resolveOffset).toBe("function");
    expect(typeof engine.moveSymbol).toBe("function");
  }, 10_000);

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

describe("dispatchRequest post-write diagnostics (checkTypeErrors)", () => {
  test("returns typeErrors fields by default when files are modified", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function multiply",
          replacement: "// comment\nexport function multiply",
          glob: "**/clean.ts",
        },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    expect((result.filesModified as string[]).length).toBeGreaterThan(0);
    expect(result).toHaveProperty("typeErrors");
    expect(result).toHaveProperty("typeErrorCount");
    expect(result).toHaveProperty("typeErrorsTruncated");
  }, 15_000);

  test("checkTypeErrors:false suppresses typeErrors even when files are modified", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function multiply",
          replacement: "// comment\nexport function multiply",
          glob: "**/clean.ts",
          checkTypeErrors: false,
        },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    expect((result.filesModified as string[]).length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("typeErrors");
    expect(result).not.toHaveProperty("typeErrorCount");
    expect(result).not.toHaveProperty("typeErrorsTruncated");
  }, 15_000);

  test("produces no typeErrors fields when no files are modified", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: { pattern: "__no_match_xyz__", replacement: "x" },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    expect((result.filesModified as string[]).length).toBe(0);
    expect(result).not.toHaveProperty("typeErrors");
    expect(result).not.toHaveProperty("typeErrorCount");
    expect(result).not.toHaveProperty("typeErrorsTruncated");
  }, 15_000);

  test("type errors introduced by a write are returned", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function multiply",
          replacement: "const _bad: string = 123;\nexport function multiply",
          glob: "**/clean.ts",
        },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("warn");
    expect(result).toHaveProperty("typeErrors");
    expect(result).toHaveProperty("typeErrorCount");
    expect(result).toHaveProperty("typeErrorsTruncated");

    const typeErrors = result.typeErrors as Array<{
      file: string;
      line: number;
      col: number;
      code: number;
      message: string;
    }>;
    expect(typeErrors.length).toBeGreaterThanOrEqual(1);
    expect(result.typeErrorCount as number).toBeGreaterThanOrEqual(1);
    expect(typeErrors.every((d) => d.file.endsWith("clean.ts"))).toBe(true);
    for (const d of typeErrors) {
      expect(d.line).toBeGreaterThan(0);
      expect(d.col).toBeGreaterThan(0);
      expect(typeof d.code).toBe("number");
      expect(d.code).toBeGreaterThan(0);
      expect(d.message.length).toBeGreaterThan(0);
    }
  }, 15_000);

  test("errors in unmodified files are excluded from typeErrors", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function multiply",
          replacement: "// type-safe\nexport function multiply",
          glob: "**/clean.ts",
        },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    expect(result.typeErrorCount).toBe(0);
    const typeErrors = result.typeErrors as Array<{ file: string }>;
    expect(typeErrors.every((d) => d.file.endsWith("clean.ts"))).toBe(true);
  }, 15_000);

  test("clean modified files produce an empty typeErrors array", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function multiply",
          replacement: "// type-safe\nexport function multiply",
          glob: "**/clean.ts",
        },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    expect(result).toHaveProperty("filesModified");
    expect(result).toHaveProperty("typeErrors");
    expect(result).toHaveProperty("typeErrorCount");
    expect(result).toHaveProperty("typeErrorsTruncated");
    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    expect(result.typeErrorsTruncated).toBe(false);
  }, 15_000);
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

  test("dispatches findReferences and returns references shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const file = path.join(dir, "src/clean.ts");
    const result = (await dispatchRequest(
      { method: "findReferences", params: { file, line: 1, col: 17 } },
      dir,
    )) as Record<string, unknown>;
    expect(typeof result.status).toBe("string");
    if (result.status === "success") {
      expect(result).toHaveProperty("references");
    } else {
      expect(result).toHaveProperty("error");
    }
  }, 15_000);

  test("dispatches getDefinition and returns definition shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const file = path.join(dir, "src/clean.ts");
    const result = (await dispatchRequest(
      { method: "getDefinition", params: { file, line: 1, col: 17 } },
      dir,
    )) as Record<string, unknown>;
    expect(typeof result.status).toBe("string");
    if (result.status === "success") {
      expect(result).toHaveProperty("definitions");
    } else {
      expect(result).toHaveProperty("error");
    }
  }, 15_000);

  test("dispatches rename and returns result shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const file = path.join(dir, "src/clean.ts");
    const result = (await dispatchRequest(
      { method: "rename", params: { file, line: 1, col: 17, newName: "multiplied" } },
      dir,
    )) as Record<string, unknown>;
    expect(typeof result.status).toBe("string");
    if (result.status === "success") {
      expect(result).toHaveProperty("filesModified");
    } else {
      expect(result).toHaveProperty("error");
    }
  }, 15_000);

  test("dispatches moveFile and returns result shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const oldPath = path.join(dir, "src/clean.ts");
    const newPath = path.join(dir, "src/relocated.ts");
    const result = (await dispatchRequest(
      { method: "moveFile", params: { oldPath, newPath } },
      dir,
    )) as Record<string, unknown>;
    expect(typeof result.status).toBe("string");
    if (result.status === "success") {
      expect(result).toHaveProperty("filesModified");
    } else {
      expect(result).toHaveProperty("error");
    }
  }, 15_000);

  test("dispatches moveSymbol and returns result shape", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const sourceFile = path.join(dir, "src/clean.ts");
    const destFile = path.join(dir, "src/multiply.ts");
    const result = (await dispatchRequest(
      { method: "moveSymbol", params: { sourceFile, symbolName: "multiply", destFile } },
      dir,
    )) as Record<string, unknown>;
    expect(typeof result.status).toBe("string");
    if (result.status === "success") {
      expect(result).toHaveProperty("filesModified");
    } else {
      expect(result).toHaveProperty("error");
    }
  }, 15_000);
});

describe("dispatchRequest getTypeErrors engine routing in a Vue project", () => {
  test("single-file call on a .vue file returns that file's diagnostics instead of throwing", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
    const file = path.join(dir, "src/Broken.vue");

    const result = (await dispatchRequest(
      { method: "getTypeErrors", params: { file } },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    const diagnostics = result.diagnostics as Array<{ file: string; code: number }>;
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.file === file)).toBe(true);
    expect(result.errorCount).toBe(diagnostics.length);
  }, 15_000);

  test("single-file call on a .ts file in the same Vue project also routes through VolarEngine without throwing", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
    const file = path.join(dir, "src/utils.ts");

    const result = (await dispatchRequest(
      { method: "getTypeErrors", params: { file } },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    const diagnostics = result.diagnostics as Array<{ file: string; code: number }>;
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.file === file)).toBe(true);
  }, 15_000);

  test("project-wide call (no file param) includes diagnostics from both .ts and .vue files", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueErrors.name);

    const result = (await dispatchRequest({ method: "getTypeErrors", params: {} }, dir)) as Record<
      string,
      unknown
    >;

    expect(result.status).toBe("success");
    const diagnostics = result.diagnostics as Array<{ file: string }>;
    expect(diagnostics.some((d) => d.file.endsWith(".ts"))).toBe(true);
    expect(diagnostics.some((d) => d.file.endsWith(".vue"))).toBe(true);
    expect(result.errorCount).toBe(diagnostics.length);
  }, 15_000);

  test("project-wide call on a non-Vue project is unaffected — same diagnostics as before the fix", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);

    const result = (await dispatchRequest({ method: "getTypeErrors", params: {} }, dir)) as Record<
      string,
      unknown
    >;

    expect(result.status).toBe("success");
    const diagnostics = result.diagnostics as Array<{ file: string }>;
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.file.endsWith(".ts"))).toBe(true);
    expect(diagnostics.every((d) => !d.file.endsWith(".vue"))).toBe(true);
  }, 15_000);

  test("single-file call resolves the tsconfig nearest the given file, not the workspace root's", async ({
    seedInlineFixture,
  }) => {
    // Workspace root has a plain TS-only tsconfig with no .vue awareness; the requested
    // file lives in a nested project with its own tsconfig that does include .vue files.
    // Routing off the file (not the workspace root) is what selects VolarEngine here.
    const dir = await seedInlineFixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true },
        include: ["outer.ts"],
      }),
      "outer.ts": "export const outer: string = 'hello';\n",
      "sub/tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
        },
        include: ["**/*.ts", "**/*.vue"],
      }),
      "sub/Broken.vue":
        '<script setup lang="ts">\nconst x: number = "hello";\n</script>\n<template><div>{{ x }}</div></template>\n',
    });
    const file = path.join(dir, "sub/Broken.vue");

    const result = (await dispatchRequest(
      { method: "getTypeErrors", params: { file } },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    const diagnostics = result.diagnostics as Array<{ file: string; code: number }>;
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.file === file)).toBe(true);
  }, 15_000);
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
