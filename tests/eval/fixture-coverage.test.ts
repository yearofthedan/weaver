import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "../../src/mcp.js";

const FIXTURES_DIR = join(import.meta.dirname, "../../eval/fixtures");

describe("eval fixture coverage", () => {
  it("TOOL_NAMES is non-empty and has the expected count", () => {
    // Pinning the count means silently dropping a tool is caught here.
    expect(TOOL_NAMES.length).toBe(9);
    expect(TOOL_NAMES).toContain("rename");
    expect(TOOL_NAMES).toContain("replaceText");
  });

  it("every registered MCP tool has an eval fixture", () => {
    for (const name of TOOL_NAMES) {
      expect(
        existsSync(join(FIXTURES_DIR, `${name}.json`)),
        `eval fixture exists for tool: ${name}`,
      ).toBe(true);
    }
  });

  it("no fixture file exists for a tool that is not registered", () => {
    // Prevents orphaned fixtures going unnoticed when a tool is removed.
    const fixtureNames = readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
    for (const name of fixtureNames) {
      expect(TOOL_NAMES, `fixture ${name}.json has no registered tool`).toContain(name);
    }
  });
});
