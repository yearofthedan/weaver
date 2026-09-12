import * as path from "node:path";
import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { dispatchRequest } from "./dispatcher.js";
import { shouldSuppressSelfWrite } from "./self-write-state.js";

/**
 * The ledger only sees a write that went through the shared filesystem, so
 * these drive a real operation through `dispatchRequest` rather than writing
 * through the shared instance directly. An operation that built its own
 * `FileSystem` would still pass every test that does the latter.
 */
describe("a write dispatched through the daemon", () => {
  test("is recorded, so its own watcher event is suppressed", async ({ seedInlineFixture }) => {
    const dir = await seedInlineFixture({
      "tsconfig.json": JSON.stringify({ include: ["src"] }),
      "src/greet.ts": "export const greeting = 'hello';\n",
    });
    const file = path.join(dir, "src/greet.ts");

    const result = await dispatchRequest(
      {
        method: "replaceText",
        params: { pattern: "hello", replacement: "goodbye", workspace: dir },
      },
      dir,
    );
    expect(result.status).not.toBe("error");

    expect(shouldSuppressSelfWrite(file)).toBe(true);
  });

  test("leaves a file it did not touch unsuppressed", async ({ seedInlineFixture }) => {
    const dir = await seedInlineFixture({
      "tsconfig.json": JSON.stringify({ include: ["src"] }),
      "src/greet.ts": "export const greeting = 'hello';\n",
      "src/untouched.ts": "export const other = 'hello';\n",
    });

    await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "hello",
          replacement: "goodbye",
          glob: "src/greet.ts",
          workspace: dir,
        },
      },
      dir,
    );

    expect(shouldSuppressSelfWrite(path.join(dir, "src/untouched.ts"))).toBe(false);
  });

  /**
   * The retained diagnostic parse is only correct while it matches disk. This
   * drives the production wiring — a test that builds its own recording
   * filesystem would pass even if the daemon's shared instance stopped
   * evicting. `checkTypeErrors: false` skips the post-write refresh, so the
   * eviction at the write is the only thing that can keep the answer honest.
   */
  test("does not answer a later check from the text it replaced", async ({ seedInlineFixture }) => {
    const dir = await seedInlineFixture({
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }),
      "src/value.ts": "export const value: number = 1;\n",
    });
    const file = path.join(dir, "src/value.ts");

    const warm = await dispatchRequest({ method: "getTypeErrors", params: { file } }, dir);
    expect(warm).toMatchObject({ status: "success", errorCount: 0 });

    const written = await dispatchRequest(
      {
        method: "replaceText",
        params: { pattern: "1", replacement: "'not a number'", checkTypeErrors: false },
      },
      dir,
    );
    expect(written.status).not.toBe("error");

    const after = await dispatchRequest({ method: "getTypeErrors", params: { file } }, dir);
    expect(after).toMatchObject({
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: 2322 })]),
    });
  });

  test("does not answer a later check from replaced text in a .mts file", async ({
    seedInlineFixture,
  }) => {
    const dir = await seedInlineFixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext" },
        include: ["src"],
      }),
      "src/value.mts": "export const value: number = 1;\n",
    });
    const file = path.join(dir, "src/value.mts");

    const warm = await dispatchRequest({ method: "getTypeErrors", params: { file } }, dir);
    expect(warm).toMatchObject({ status: "success", errorCount: 0 });

    const written = await dispatchRequest(
      {
        method: "replaceText",
        params: { pattern: "1", replacement: "'not a number'", checkTypeErrors: false },
      },
      dir,
    );
    expect(written.status).not.toBe("error");

    const after = await dispatchRequest({ method: "getTypeErrors", params: { file } }, dir);
    expect(after).toMatchObject({
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: 2322 })]),
    });
  });
});

/**
 * With `checkTypeErrors: false` nothing else repairs ts-morph's cached copy of
 * a written file, so these reads are only correct if the dispatch that wrote
 * refreshed the project before returning. Each warms the project first, since
 * a project that was never loaded has nothing stale to answer from.
 */
describe("a read dispatched after a write that skipped the type check", () => {
  test("answers from the text on disk once an inserted line has moved the symbol", async ({
    seedInlineFixture,
  }) => {
    const dir = await seedInlineFixture({
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }),
      "src/lib.ts": "export function greet(name: string): string {\n  return name;\n}\n",
      "src/a.ts":
        'import { greet } from "./lib";\n\nconsole.log(greet("one"));\nconsole.log(greet("two"));\n',
    });
    const lib = path.join(dir, "src/lib.ts");
    const caller = path.join(dir, "src/a.ts");

    const warm = await dispatchRequest(
      { method: "findReferences", params: { file: lib, line: 1, col: 17 } },
      dir,
    );
    expect(warm).toMatchObject({ status: "success", symbolName: "greet" });

    const written = await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function",
          replacement: "// banner\nexport function",
          checkTypeErrors: false,
        },
      },
      dir,
    );
    expect(written.status).not.toBe("error");

    const after = (await dispatchRequest(
      { method: "findReferences", params: { file: lib, line: 2, col: 17 } },
      dir,
    )) as Record<string, unknown>;
    expect(after).toMatchObject({ status: "success", symbolName: "greet" });
    expect(after.references).toEqual(
      expect.arrayContaining([
        { file: lib, line: 2, col: 17, length: 5 },
        { file: caller, line: 1, col: 10, length: 5 },
        { file: caller, line: 3, col: 13, length: 5 },
        { file: caller, line: 4, col: 13, length: 5 },
      ]),
    );
  });

  test("answers from disk for a .mts source, which the engine tracks too", async ({
    seedInlineFixture,
  }) => {
    const dir = await seedInlineFixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext" },
        include: ["src/**/*.mts"],
      }),
      "src/lib.mts": "export function greet(name: string): string {\n  return name;\n}\n",
    });
    const lib = path.join(dir, "src/lib.mts");

    const warm = await dispatchRequest(
      { method: "findReferences", params: { file: lib, line: 1, col: 17 } },
      dir,
    );
    expect(warm).toMatchObject({ status: "success", symbolName: "greet" });

    const written = await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function",
          replacement: "// banner\nexport function",
          checkTypeErrors: false,
        },
      },
      dir,
    );
    expect(written.status).not.toBe("error");

    const after = await dispatchRequest(
      { method: "findReferences", params: { file: lib, line: 2, col: 17 } },
      dir,
    );
    expect(after).toMatchObject({ status: "success", symbolName: "greet" });
  });

  test("completes a read of a surviving file after an unchecked deleteFile", async ({
    seedInlineFixture,
  }) => {
    const dir = await seedInlineFixture({
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }),
      "src/keep.ts": "export function keep(): number {\n  return 1;\n}\n",
      "src/gone.ts": "export function gone(): number {\n  return 2;\n}\n",
    });
    const keep = path.join(dir, "src/keep.ts");
    const gone = path.join(dir, "src/gone.ts");

    const warm = await dispatchRequest(
      { method: "findReferences", params: { file: gone, line: 1, col: 17 } },
      dir,
    );
    expect(warm).toMatchObject({ status: "success", symbolName: "gone" });

    const deleted = await dispatchRequest(
      { method: "deleteFile", params: { file: gone, checkTypeErrors: false } },
      dir,
    );
    expect(deleted.status).not.toBe("error");

    const after = await dispatchRequest(
      { method: "findReferences", params: { file: keep, line: 1, col: 17 } },
      dir,
    );
    expect(after).toMatchObject({ status: "success", symbolName: "keep" });
  });

  test("completes a read after an unchecked write in a Vue project", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const file = path.join(dir, "src/composables/useCounter.ts");

    const written = await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "initialValue = 0",
          replacement: "initialValue: number = 0",
          glob: "src/composables/useCounter.ts",
          checkTypeErrors: false,
        },
      },
      dir,
    );
    expect(written.status).not.toBe("error");

    // Only non-breakage: the read is answered by Volar, which the drain does not
    // reach, and this write leaves the project error-free either way.
    const after = await dispatchRequest({ method: "getTypeErrors", params: { file } }, dir);
    expect(after).toMatchObject({ status: "success", errorCount: 0 });
  });

  test("still answers from disk when the post-write check ran and refreshed", async ({
    seedInlineFixture,
  }) => {
    const dir = await seedInlineFixture({
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }),
      "src/lib.ts": "export function greet(name: string): string {\n  return name;\n}\n",
    });
    const lib = path.join(dir, "src/lib.ts");

    await dispatchRequest(
      { method: "findReferences", params: { file: lib, line: 1, col: 17 } },
      dir,
    );

    const written = await dispatchRequest(
      {
        method: "replaceText",
        params: { pattern: "export function", replacement: "// banner\nexport function" },
      },
      dir,
    );
    expect(written).toMatchObject({ status: "success", typeErrorCount: 0 });

    const after = await dispatchRequest(
      { method: "findReferences", params: { file: lib, line: 2, col: 17 } },
      dir,
    );
    expect(after).toMatchObject({ status: "success", symbolName: "greet" });
  });
});
