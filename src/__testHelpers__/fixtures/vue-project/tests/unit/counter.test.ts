import { describe, expect, it } from "vitest";
import { useCounter } from "../../src/composables/useCounter";

describe("counter", () => {
  it("increments", () => {
    const c = useCounter();
    c.increment();
    expect(c.count()).toBe(1);
  });
});
