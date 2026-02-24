/**
 * Direct in-process test for runServe's validation-error early-return.
 * The happy path (which starts the MCP server over stdio) is covered by the
 * existing serve.test.ts integration tests that spawn a subprocess.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runServe } from "../../src/mcp.js";

describe("runServe validation", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes VALIDATION_ERROR and exits 1 when workspace does not exist", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("EXIT");
    }) as () => never);

    await expect(runServe({ workspace: "/nonexistent/path/xyz_test_abc" })).rejects.toThrow("EXIT");

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain('"VALIDATION_ERROR"');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
