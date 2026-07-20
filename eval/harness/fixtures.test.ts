import { describe, expect, it } from "vitest";
import { loadFixture, operationToSubcommand } from "./fixtures.js";

describe("operationToSubcommand", () => {
  it("converts a camelCase operation name to its kebab-case subcommand", () => {
    expect(operationToSubcommand("findReferences")).toBe("find-references");
  });

  it("leaves a single-word operation name unchanged", () => {
    expect(operationToSubcommand("rename")).toBe("rename");
  });
});

describe("loadFixture", () => {
  it("returns the content of a fixture file that exists", () => {
    const content = loadFixture("rename.json");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws a friendly message naming the fixture and its expected path when the file is missing", () => {
    expect(() => loadFixture("nonExistent.json")).toThrow(
      'Case table references fixture "nonExistent.json" but',
    );
  });
});
