import * as path from "node:path";
import { describe, expect, vi } from "vitest";
import { fixtureTest as test } from "../__testHelpers__/helpers.js";
import type { Engine } from "../ts-engine/types.js";
import { extractFunction } from "./extractFunction.js";

describe("extractFunction operation", () => {
  test("throws FILE_NOT_FOUND for a missing source file", async ({ dir, seedInlineFixture }) => {
    await seedInlineFixture({ "src/.keep": "" });
    const fakeEngine = {} as Engine;

    await expect(
      extractFunction(
        fakeEngine,
        path.join(dir, "src/does-not-exist.ts"),
        1,
        1,
        1,
        10,
        "myFn",
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        {} as any,
      ),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  test("delegates to engine.extractFunction with correct arguments and returns its result", async ({
    dir,
    seedInlineFixture,
  }) => {
    await seedInlineFixture({ "src/target.ts": "export function foo() {}\n" });
    const filePath = path.join(dir, "src/target.ts");

    const expectedResult = {
      filesModified: [filePath],
      filesSkipped: [],
      functionName: "extracted",
      parameterCount: 1,
    };

    const mockEngine = {
      extractFunction: vi.fn().mockResolvedValue(expectedResult),
    } as unknown as Engine;

    // biome-ignore lint/suspicious/noExplicitAny: test stub
    const scope = {} as any;

    const result = await extractFunction(mockEngine, filePath, 2, 3, 4, 19, "extracted", scope);

    expect(mockEngine.extractFunction).toHaveBeenCalledWith(
      filePath,
      2,
      3,
      4,
      19,
      "extracted",
      scope,
    );
    expect(result).toBe(expectedResult);
  });
});
