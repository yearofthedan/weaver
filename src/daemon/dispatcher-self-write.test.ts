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
});
