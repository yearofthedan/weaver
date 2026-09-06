import * as path from "node:path";
import { describe, expect } from "vitest";
import { fixtureTest as test } from "../__testHelpers__/helpers.js";
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
});
