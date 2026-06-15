import { describe, expect, it } from "vitest";
import { SKILL_NAMES } from "./context.js";
import { BASH_TOOL, COMPETING_TOOLS } from "./tools.js";

describe("COMPETING_TOOLS", () => {
  it("declares the four expected competitor tools", () => {
    const names = COMPETING_TOOLS.map((t) => t.function.name);
    expect(COMPETING_TOOLS).toHaveLength(4);
    expect(new Set(names)).toEqual(new Set(["Edit", "Grep", "Glob", "Read"]));
  });

  // A competitor that shadows a skill or bash would make the lane's pass/fail
  // ambiguous — the first tool call could no longer be attributed to one or the other.
  it("uses names that collide with no skill name nor the bash tool", () => {
    const names = COMPETING_TOOLS.map((t) => t.function.name);
    const reserved = [...SKILL_NAMES, BASH_TOOL.function.name];
    for (const name of names) {
      expect(reserved).not.toContain(name);
    }
  });
});
