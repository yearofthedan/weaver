import { describe, expect, it } from "vitest";
import { EngineError } from "../../src/utils/errors.js";

describe("EngineError", () => {
  it("constructs with message and code", () => {
    const err = new EngineError("file missing", "FILE_NOT_FOUND");
    expect(err.message).toBe("file missing");
    expect(err.code).toBe("FILE_NOT_FOUND");
    expect(err.name).toBe("EngineError");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof EngineError).toBe(true);
  });

  it("is() returns true for any EngineError when no code given", () => {
    const err = new EngineError("oops", "SYMBOL_NOT_FOUND");
    expect(EngineError.is(err)).toBe(true);
  });

  it("is() returns true for matching code", () => {
    const err = new EngineError("oops", "SYMBOL_NOT_FOUND");
    expect(EngineError.is(err, "SYMBOL_NOT_FOUND")).toBe(true);
  });

  it("is() returns false for wrong code", () => {
    const err = new EngineError("oops", "SYMBOL_NOT_FOUND");
    expect(EngineError.is(err, "FILE_NOT_FOUND")).toBe(false);
  });

  it("is() returns false for plain Error", () => {
    const err = new Error("plain");
    expect(EngineError.is(err)).toBe(false);
  });

  it("is() returns false for non-error values", () => {
    expect(EngineError.is(null)).toBe(false);
    expect(EngineError.is(undefined)).toBe(false);
    expect(EngineError.is("string")).toBe(false);
    expect(EngineError.is(42)).toBe(false);
  });
});
