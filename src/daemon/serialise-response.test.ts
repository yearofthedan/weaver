import { describe, expect, it } from "vitest";
import type { DispatchResponse } from "./dispatcher.js";
import { serialiseResponse } from "./serialise-response.js";

describe("serialiseResponse", () => {
  it("returns the JSON of an ordinary success response followed by a newline", () => {
    const response: DispatchResponse = { status: "success", filesModified: ["a.ts"] };

    expect(serialiseResponse(response)).toBe(
      `${JSON.stringify({ status: "success", filesModified: ["a.ts"] })}\n`,
    );
  });

  it("returns the JSON of an ordinary error response followed by a newline", () => {
    const response: DispatchResponse = {
      status: "error",
      error: "FILE_NOT_FOUND",
      message: "File not found: a.ts",
    };

    expect(serialiseResponse(response)).toBe(`${JSON.stringify(response)}\n`);
  });

  it("returns an INTERNAL_ERROR envelope instead of throwing when the response is circular", () => {
    const circular: Record<string, unknown> = { status: "success" };
    circular.self = circular;

    expect(serialiseResponse(circular as unknown as DispatchResponse)).toBe(
      `${JSON.stringify({
        status: "error",
        error: "INTERNAL_ERROR",
        message: "response could not be serialised",
      })}\n`,
    );
  });
});
