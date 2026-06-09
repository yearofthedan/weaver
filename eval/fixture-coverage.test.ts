import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPERATION_NAMES } from "../src/daemon/dispatcher.js";

const FIXTURES_DIR = join(import.meta.dirname, "./fixtures");

describe("eval fixture coverage", () => {
  it("every registered operation has an eval fixture", () => {
    for (const name of OPERATION_NAMES) {
      expect(
        existsSync(join(FIXTURES_DIR, `${name}.json`)),
        `eval fixture exists for operation: ${name}`,
      ).toBe(true);
    }
  });

  it("no fixture file exists for an operation that is not registered", () => {
    // Prevents orphaned fixtures going unnoticed when an operation is removed.
    const fixtureNames = readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
    for (const name of fixtureNames) {
      expect(OPERATION_NAMES, `fixture ${name}.json has no registered operation`).toContain(name);
    }
  });
});
