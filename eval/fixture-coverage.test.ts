import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FIXTURES_DIR = join(import.meta.dirname, "./fixtures");

/**
 * The canonical set of operation names, one per eval fixture.
 * Pinning this list means silently dropping or adding an operation is caught here.
 */
const EXPECTED_OPERATIONS = [
  "deleteFile",
  "extractFunction",
  "findImporters",
  "findReferences",
  "getDefinition",
  "getTypeErrors",
  "moveDirectory",
  "moveFile",
  "moveSymbol",
  "rename",
  "replaceText",
  "searchText",
] as const;

describe("eval fixture coverage", () => {
  it("the expected operation list is complete (12 operations)", () => {
    expect(EXPECTED_OPERATIONS.length).toBe(12);
    expect(EXPECTED_OPERATIONS).toContain("rename");
    expect(EXPECTED_OPERATIONS).toContain("replaceText");
  });

  it("every expected operation has an eval fixture", () => {
    for (const name of EXPECTED_OPERATIONS) {
      expect(
        existsSync(join(FIXTURES_DIR, `${name}.json`)),
        `eval fixture exists for operation: ${name}`,
      ).toBe(true);
    }
  });

  it("no fixture file exists for an operation not in the expected list", () => {
    // Prevents orphaned fixtures going unnoticed when an operation is removed.
    const fixtureNames = readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
    for (const name of fixtureNames) {
      expect(
        EXPECTED_OPERATIONS as readonly string[],
        `fixture ${name}.json has no expected operation`,
      ).toContain(name);
    }
  });
});
