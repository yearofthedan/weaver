import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../__testHelpers__/helpers.js";
import { TsMorphCompiler } from "../compilers/ts.js";
import { dispatchRequest, makeRegistry } from "./dispatcher.js";

describe("makeRegistry", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("returns an object with projectCompiler and tsCompiler functions", () => {
    const registry = makeRegistry("/any/file.ts");
    expect(typeof registry.projectCompiler).toBe("function");
    expect(typeof registry.tsCompiler).toBe("function");
  });

  it("tsCompiler resolves to a TsMorphCompiler with Compiler methods", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const registry = makeRegistry(path.join(dir, "src/utils.ts"));
    const compiler = await registry.tsCompiler();
    expect(compiler).toBeInstanceOf(TsMorphCompiler);
    expect(typeof compiler.resolveOffset).toBe("function");
    expect(typeof compiler.afterSymbolMove).toBe("function");
  }, 10_000);

  it("projectCompiler resolves to a TsMorphCompiler for a TS-only project", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const registry = makeRegistry(path.join(dir, "src/utils.ts"));
    const compiler = await registry.projectCompiler();
    expect(compiler).toBeInstanceOf(TsMorphCompiler);
  }, 10_000);
});

describe("dispatchRequest param validation", () => {
  const workspace = "/tmp/test-workspace";

  it.each([
    [
      "rename with line as string",
      { method: "rename", params: { file: "/tmp/test-workspace/a.ts", line: "five", col: 1, newName: "foo" } },
    ],
    [
      "rename missing required params",
      { method: "rename", params: { file: "/tmp/test-workspace/a.ts" } },
    ],
    [
      "searchText with pattern as number",
      { method: "searchText", params: { pattern: 123 } },
    ],
    [
      "findReferences with col as null",
      { method: "findReferences", params: { file: "/tmp/test-workspace/a.ts", line: 1, col: null } },
    ],
    [
      "replaceText with both pattern and edits",
      {
        method: "replaceText",
        params: {
          pattern: "foo",
          replacement: "bar",
          edits: [{ file: "/tmp/test-workspace/a.ts", line: 1, col: 1, oldText: "x", newText: "y" }],
        },
      },
    ],
    [
      "replaceText with neither pattern nor edits",
      { method: "replaceText", params: {} },
    ],
  ])("returns VALIDATION_ERROR — %s", async (_desc, request) => {
    const result = await dispatchRequest(request, workspace);
    expect(result).toMatchObject({ ok: false, error: "VALIDATION_ERROR" });
  });

  it("returns UNKNOWN_METHOD for an unrecognised method", async () => {
    const result = await dispatchRequest({ method: "doSomethingFake", params: {} }, workspace);
    expect(result).toMatchObject({ ok: false, error: "UNKNOWN_METHOD" });
  });
});

describe("dispatchRequest success format", () => {
  it("returns ok:true and result fields without a message field", async () => {
    // searchText on a pattern that matches nothing is the cheapest operation to invoke
    const result = (await dispatchRequest(
      { method: "searchText", params: { pattern: "__nonexistent_pattern_xyz__" } },
      "/tmp",
    )) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result).toHaveProperty("matches");
    expect(result).toHaveProperty("truncated");
    expect(result).not.toHaveProperty("message");
  });
});

describe("dispatchRequest post-write diagnostics (checkTypeErrors)", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("returns typeErrors fields by default when files are modified", async () => {
    const dir = copyFixture(FIXTURES.tsErrors.name);
    dirs.push(dir);

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

    expect(result.ok).toBe(true);
    expect((result.filesModified as string[]).length).toBeGreaterThan(0);
    expect(result).toHaveProperty("typeErrors");
    expect(result).toHaveProperty("typeErrorCount");
    expect(result).toHaveProperty("typeErrorsTruncated");
  }, 15_000);

  it("checkTypeErrors:false suppresses typeErrors even when files are modified", async () => {
    const dir = copyFixture(FIXTURES.tsErrors.name);
    dirs.push(dir);

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

    expect(result.ok).toBe(true);
    expect((result.filesModified as string[]).length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("typeErrors");
    expect(result).not.toHaveProperty("typeErrorCount");
    expect(result).not.toHaveProperty("typeErrorsTruncated");
  }, 15_000);

  it("produces no typeErrors fields when no files are modified", async () => {
    const dir = copyFixture(FIXTURES.tsErrors.name);
    dirs.push(dir);

    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: { pattern: "__no_match_xyz__", replacement: "x" },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect((result.filesModified as string[]).length).toBe(0);
    expect(result).not.toHaveProperty("typeErrors");
    expect(result).not.toHaveProperty("typeErrorCount");
    expect(result).not.toHaveProperty("typeErrorsTruncated");
  }, 15_000);

  it("type errors introduced by a write are returned", async () => {
    const dir = copyFixture(FIXTURES.tsErrors.name);
    dirs.push(dir);

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

    expect(result.ok).toBe(true);
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

  it("errors in unmodified files are excluded from typeErrors", async () => {
    const dir = copyFixture(FIXTURES.tsErrors.name);
    dirs.push(dir);

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

    expect(result.ok).toBe(true);
    expect(result.typeErrorCount).toBe(0);
    const typeErrors = result.typeErrors as Array<{ file: string }>;
    expect(typeErrors.every((d) => d.file.endsWith("clean.ts"))).toBe(true);
  }, 15_000);

  it("clean modified files produce an empty typeErrors array", async () => {
    const dir = copyFixture(FIXTURES.tsErrors.name);
    dirs.push(dir);

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

    expect(result.ok).toBe(true);
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
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("dispatches getTypeErrors and returns diagnostics shape", async () => {
    const dir = copyFixture(FIXTURES.tsErrors.name);
    dirs.push(dir);
    const result = (await dispatchRequest({ method: "getTypeErrors", params: {} }, dir)) as Record<
      string,
      unknown
    >;
    expect(result.ok).toBe(true);
    expect(result).toHaveProperty("diagnostics");
    expect(result).toHaveProperty("errorCount");
    expect(result).toHaveProperty("truncated");
  }, 15_000);

  it("dispatches findReferences and returns references shape", async () => {
    const dir = copyFixture(FIXTURES.tsErrors.name);
    dirs.push(dir);
    const file = path.join(dir, "src/clean.ts");
    const result = (await dispatchRequest(
      { method: "findReferences", params: { file, line: 1, col: 17 } },
      dir,
    )) as Record<string, unknown>;
    expect(typeof result.ok).toBe("boolean");
    if (result.ok) {
      expect(result).toHaveProperty("references");
    } else {
      expect(result).toHaveProperty("error");
    }
  }, 15_000);

  it("dispatches getDefinition and returns definition shape", async () => {
    const dir = copyFixture(FIXTURES.tsErrors.name);
    dirs.push(dir);
    const file = path.join(dir, "src/clean.ts");
    const result = (await dispatchRequest(
      { method: "getDefinition", params: { file, line: 1, col: 17 } },
      dir,
    )) as Record<string, unknown>;
    expect(typeof result.ok).toBe("boolean");
    if (result.ok) {
      expect(result).toHaveProperty("definitions");
    } else {
      expect(result).toHaveProperty("error");
    }
  }, 15_000);

  it("dispatches rename and returns result shape", async () => {
    const dir = copyFixture(FIXTURES.tsErrors.name);
    dirs.push(dir);
    const file = path.join(dir, "src/clean.ts");
    const result = (await dispatchRequest(
      { method: "rename", params: { file, line: 1, col: 17, newName: "multiplied" } },
      dir,
    )) as Record<string, unknown>;
    expect(typeof result.ok).toBe("boolean");
    if (result.ok) {
      expect(result).toHaveProperty("filesModified");
    } else {
      expect(result).toHaveProperty("error");
    }
  }, 15_000);

  it("dispatches moveFile and returns result shape", async () => {
    const dir = copyFixture(FIXTURES.tsErrors.name);
    dirs.push(dir);
    const oldPath = path.join(dir, "src/clean.ts");
    const newPath = path.join(dir, "src/relocated.ts");
    const result = (await dispatchRequest(
      { method: "moveFile", params: { oldPath, newPath } },
      dir,
    )) as Record<string, unknown>;
    expect(typeof result.ok).toBe("boolean");
    if (result.ok) {
      expect(result).toHaveProperty("filesModified");
    } else {
      expect(result).toHaveProperty("error");
    }
  }, 15_000);

  it("dispatches moveSymbol and returns result shape", async () => {
    const dir = copyFixture(FIXTURES.tsErrors.name);
    dirs.push(dir);
    const sourceFile = path.join(dir, "src/clean.ts");
    const destFile = path.join(dir, "src/multiply.ts");
    const result = (await dispatchRequest(
      { method: "moveSymbol", params: { sourceFile, symbolName: "multiply", destFile } },
      dir,
    )) as Record<string, unknown>;
    expect(typeof result.ok).toBe("boolean");
    if (result.ok) {
      expect(result).toHaveProperty("filesModified");
    } else {
      expect(result).toHaveProperty("error");
    }
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
    expect(result.ok).toBe(false);
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
    expect(result.ok).toBe(false);
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
    expect(result.ok).toBe(false);
    expect(result.error).toBe("INVALID_PATH");
    expect(result.message).toContain("URI fragment or query character");
    expect(result.message).toContain("file");
  });
});
