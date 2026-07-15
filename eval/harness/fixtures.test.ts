import * as fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadFixture, operationToSubcommand } from "./fixtures.js";

// Wraps the real readFileSync so most calls behave normally; individual
// tests override a single call with mockImplementationOnce to inject a
// synthetic read error, then fall back to the real implementation
// automatically once consumed.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

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

  it("re-throws the original error unchanged when the read fails for a reason other than a missing file", () => {
    const eacces = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw eacces;
    });
    expect(() => loadFixture("rename.json")).toThrow("EACCES: permission denied");
  });

  it("re-throws a thrown value as-is when it carries an ENOENT code but is not an Error instance", () => {
    const nonError = { code: "ENOENT" };
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw nonError;
    });
    let caught: unknown;
    try {
      loadFixture("rename.json");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(nonError);
  });
});
