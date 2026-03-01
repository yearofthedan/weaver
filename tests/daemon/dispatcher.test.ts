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

  // AC3: no checkTypeErrors param → no type error fields in response
  it("AC3 — omitting checkTypeErrors produces no typeErrors fields in the result", async () => {
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: { pattern: "__no_match_xyz__", replacement: "x" },
      },
      "/tmp",
    )) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("typeErrors");
    expect(result).not.toHaveProperty("typeErrorCount");
    expect(result).not.toHaveProperty("typeErrorsTruncated");
  });

  // AC3: explicit checkTypeErrors:false → no type error fields
  it("AC3 — checkTypeErrors:false produces no typeErrors fields", async () => {
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: { pattern: "__no_match_xyz__", replacement: "x", checkTypeErrors: false },
      },
      "/tmp",
    )) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("typeErrors");
    expect(result).not.toHaveProperty("typeErrorCount");
    expect(result).not.toHaveProperty("typeErrorsTruncated");
  });

  // AC2: checkTypeErrors:true, operation modifies a clean file → typeErrors:[], count:0
  it("AC2 — checkTypeErrors:true with clean modified files produces empty typeErrors array", async () => {
    const dir = copyFixture("ts-errors");
    dirs.push(dir);

    // Add a harmless comment to clean.ts (no type errors introduced)
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function multiply",
          replacement: "// type-safe\nexport function multiply",
          glob: "**/clean.ts",
          checkTypeErrors: true,
        },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result).toHaveProperty("filesModified");
    // The three diagnostic fields must all be present
    expect(result).toHaveProperty("typeErrors");
    expect(result).toHaveProperty("typeErrorCount");
    expect(result).toHaveProperty("typeErrorsTruncated");
    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    expect(result.typeErrorsTruncated).toBe(false);
  }, 15_000);

  // AC4: clean.ts modified, broken.ts has pre-existing errors but is NOT in filesModified
  it("AC4 — errors in unmodified files are not included in typeErrors", async () => {
    const dir = copyFixture("ts-errors");
    dirs.push(dir);

    // broken.ts has 3 pre-existing errors; we only modify clean.ts (harmlessly)
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function multiply",
          replacement: "// type-safe\nexport function multiply",
          glob: "**/clean.ts",
          checkTypeErrors: true,
        },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    // Only clean.ts was modified — broken.ts errors must not appear
    expect(result.typeErrorCount).toBe(0);
    const typeErrors = result.typeErrors as Array<{ file: string }>;
    expect(typeErrors.every((d) => d.file.endsWith("clean.ts"))).toBe(true);
  }, 15_000);

  // AC1: checkTypeErrors:true, operation introduces a type error → typeErrors populated
  it("AC1 — checkTypeErrors:true returns type errors introduced by the write operation", async () => {
    const dir = copyFixture("ts-errors");
    dirs.push(dir);

    // Prepend a type-incorrect statement to clean.ts: `const _: string = 123;`
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function multiply",
          replacement: "const _bad: string = 123;\nexport function multiply",
          glob: "**/clean.ts",
          checkTypeErrors: true,
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
    // At least one error must be reported
    expect(typeErrors.length).toBeGreaterThanOrEqual(1);
    expect(result.typeErrorCount as number).toBeGreaterThanOrEqual(1);

    // All errors must be in clean.ts (the only modified file)
    expect(typeErrors.every((d) => d.file.endsWith("clean.ts"))).toBe(true);

    // Each diagnostic must have the required shape
    for (const d of typeErrors) {
      expect(d.line).toBeGreaterThan(0);
      expect(d.col).toBeGreaterThan(0);
      expect(typeof d.code).toBe("number");
      expect(d.code).toBeGreaterThan(0);
      expect(d.message.length).toBeGreaterThan(0);
    }
  }, 15_000);
});
