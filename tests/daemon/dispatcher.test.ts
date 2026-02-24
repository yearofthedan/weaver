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
