import { afterEach, describe, expect, it } from "vitest";
import { VueEngine } from "../../src/engines/vue/engine";
import { cleanup, copyFixture } from "../helpers";

describe("VueEngine (moveSymbol stub)", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("throws NOT_SUPPORTED for moveSymbol", async () => {
    const dir = copyFixture("vue-project");
    dirs.push(dir);
    const engine = new VueEngine();

    try {
      await engine.moveSymbol(
        `${dir}/src/composables/useCounter.ts`,
        "useCounter",
        `${dir}/src/shared.ts`,
        dir,
      );
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe("NOT_SUPPORTED");
    }
  });
});
