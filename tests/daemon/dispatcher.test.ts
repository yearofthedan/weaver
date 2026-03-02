import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dispatchRequest, makeRegistry } from "../../src/daemon/dispatcher.js";
import { TsProvider } from "../../src/providers/ts.js";
import { cleanup, copyFixture } from "../helpers.js";

describe("makeRegistry", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("returns an object with projectProvider and tsProvider functions", () => {
    const registry = makeRegistry("/any/file.ts");
    expect(typeof registry.projectProvider).toBe("function");
    expect(typeof registry.tsProvider).toBe("function");
  });

  it("tsProvider resolves to a TsProvider with LanguageProvider methods", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    const registry = makeRegistry(path.join(dir, "src/utils.ts"));
    const provider = await registry.tsProvider();
    expect(provider).toBeInstanceOf(TsProvider);
    expect(typeof provider.resolveOffset).toBe("function");
    expect(typeof provider.afterSymbolMove).toBe("function");
  }, 10_000);

  it("projectProvider resolves to a TsProvider for a TS-only project", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    const registry = makeRegistry(path.join(dir, "src/utils.ts"));
    const provider = await registry.projectProvider();
    expect(provider).toBeInstanceOf(TsProvider);
  }, 10_000);
});

describe("dispatchRequest param validation", () => {
  const workspace = "/tmp/test-workspace";

  it("returns VALIDATION_ERROR when rename receives line as a string", async () => {
    const result = await dispatchRequest(
      {
        method: "rename",
        params: { file: "/tmp/test-workspace/a.ts", line: "five", col: 1, newName: "foo" },
      },
      workspace,
    );
    expect(result).toMatchObject({ ok: false, error: "VALIDATION_ERROR" });
  });

  it("returns VALIDATION_ERROR when rename is missing required params", async () => {
    const result = await dispatchRequest(
      { method: "rename", params: { file: "/tmp/test-workspace/a.ts" } },
      workspace,
    );
    expect(result).toMatchObject({ ok: false, error: "VALIDATION_ERROR" });
  });

  it("returns VALIDATION_ERROR when searchText receives pattern as a number", async () => {
    const result = await dispatchRequest(
      { method: "searchText", params: { pattern: 123 } },
      workspace,
    );
    expect(result).toMatchObject({ ok: false, error: "VALIDATION_ERROR" });
  });

  it("returns VALIDATION_ERROR when findReferences receives col as null", async () => {
    const result = await dispatchRequest(
      {
        method: "findReferences",
        params: { file: "/tmp/test-workspace/a.ts", line: 1, col: null },
      },
      workspace,
    );
    expect(result).toMatchObject({ ok: false, error: "VALIDATION_ERROR" });
  });

  it("returns UNKNOWN_METHOD for an unrecognised method", async () => {
    const result = await dispatchRequest({ method: "doSomethingFake", params: {} }, workspace);
    expect(result).toMatchObject({ ok: false, error: "UNKNOWN_METHOD" });
  });

  it("returns VALIDATION_ERROR when replaceText receives both pattern and edits", async () => {
    const result = await dispatchRequest(
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
      workspace,
    );
    expect(result).toMatchObject({ ok: false, error: "VALIDATION_ERROR" });
  });

  it("returns VALIDATION_ERROR when replaceText receives neither pattern nor edits", async () => {
    const result = await dispatchRequest({ method: "replaceText", params: {} }, workspace);
    expect(result).toMatchObject({ ok: false, error: "VALIDATION_ERROR" });
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

  // Default-on: type errors are returned without any opt-in
  it("returns typeErrors fields by default when files are modified", async () => {
    const dir = copyFixture("ts-errors");
    dirs.push(dir);

    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function multiply",
          replacement: "// comment\nexport function multiply",
          glob: "**/clean.ts",
          // checkTypeErrors omitted — default is on
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

  // Explicit opt-out suppresses diagnostics even when files are written
  it("checkTypeErrors:false suppresses typeErrors even when files are modified", async () => {
    const dir = copyFixture("ts-errors");
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

  // Guard: when nothing is written, the diagnostic block is skipped entirely
  it("produces no typeErrors fields when no files are modified", async () => {
    const dir = copyFixture("ts-errors");
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

  // Type errors introduced by a write are reported with correct shape
  it("type errors introduced by a write are returned", async () => {
    const dir = copyFixture("ts-errors");
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

  // Only the files actually written are checked — pre-existing errors elsewhere are excluded
  it("errors in unmodified files are excluded from typeErrors", async () => {
    const dir = copyFixture("ts-errors");
    dirs.push(dir);

    // broken.ts has pre-existing errors; we only modify clean.ts (harmlessly)
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

  // Clean writes produce an empty array — all three fields present, none populated
  it("clean modified files produce an empty typeErrors array", async () => {
    const dir = copyFixture("ts-errors");
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
    const dir = copyFixture("ts-errors");
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
    const dir = copyFixture("ts-errors");
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
    const dir = copyFixture("ts-errors");
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
    const dir = copyFixture("ts-errors");
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
    const dir = copyFixture("ts-errors");
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
    const dir = copyFixture("ts-errors");
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
