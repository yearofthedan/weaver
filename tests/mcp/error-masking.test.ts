import { describe, expect, it } from "vitest";
import { classifyDaemonError } from "../../src/mcp.js";

describe("classifyDaemonError", () => {
  it("returns DAEMON_STARTING for ECONNREFUSED (daemon not yet listening)", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED /tmp/sock"), {
      code: "ECONNREFUSED",
    });
    expect(classifyDaemonError(err)).toBe("DAEMON_STARTING");
  });

  it("returns DAEMON_STARTING for ENOENT (socket file missing)", () => {
    const err = Object.assign(new Error("no such file or directory"), { code: "ENOENT" });
    expect(classifyDaemonError(err)).toBe("DAEMON_STARTING");
  });

  it("returns DAEMON_STARTING for ECONNRESET (daemon crashed mid-response)", () => {
    const err = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    expect(classifyDaemonError(err)).toBe("DAEMON_STARTING");
  });

  it("returns DAEMON_STARTING for timeout (daemon slow to respond)", () => {
    const err = new Error("callDaemon timed out after 30000ms");
    expect(classifyDaemonError(err)).toBe("DAEMON_STARTING");
  });

  it("returns INTERNAL_ERROR for JSON parse failures (malformed daemon response)", () => {
    const err = new SyntaxError("Unexpected token < in JSON at position 0");
    expect(classifyDaemonError(err)).toBe("INTERNAL_ERROR");
  });

  it("returns INTERNAL_ERROR for unexpected Error types", () => {
    expect(classifyDaemonError(new Error("something else went wrong"))).toBe("INTERNAL_ERROR");
  });

  it("returns INTERNAL_ERROR for non-Error values", () => {
    expect(classifyDaemonError("string error")).toBe("INTERNAL_ERROR");
    expect(classifyDaemonError(null)).toBe("INTERNAL_ERROR");
    expect(classifyDaemonError(42)).toBe("INTERNAL_ERROR");
  });
});
