import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readFileOrThrow } from "./read-file.js";

// Wraps the real readFileSync so most calls behave normally; individual
// tests override a single call with mockImplementationOnce to inject a
// synthetic read error, then fall back to the real implementation
// automatically once consumed.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

describe("readFileOrThrow", () => {
  it("returns the UTF-8 content of a file that exists", () => {
    const content = readFileOrThrow(path.join(import.meta.dirname, "read-file.ts"), "unused");
    expect(content).toContain("export function readFileOrThrow");
  });

  it("throws the caller's not-found message when the file is missing, not the raw ENOENT", () => {
    const missing = path.join(import.meta.dirname, "does-not-exist.txt");
    expect(() => readFileOrThrow(missing, "friendly not-found text")).toThrow(
      "friendly not-found text",
    );
    expect(() => readFileOrThrow(missing, "friendly not-found text")).not.toThrow("ENOENT");
  });

  it("re-throws the original error unchanged when the read fails for a reason other than a missing file", () => {
    const eacces = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw eacces;
    });
    expect(() => readFileOrThrow("/any/path", "unused")).toThrow("EACCES: permission denied");
  });

  it("re-throws a thrown value as-is when it carries an ENOENT code but is not an Error instance", () => {
    const nonError = { code: "ENOENT" };
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw nonError;
    });
    let caught: unknown;
    try {
      readFileOrThrow("/any/path", "unused");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(nonError);
  });
});
