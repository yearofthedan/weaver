import { describe, expect, it } from "vitest";
import { SKILL_NAMES } from "./context.js";
import { BASH_TOOL, COMPETING_TOOLS, rateLaneTools } from "./tools.js";

describe("rateLaneTools", () => {
  it("contains exactly four tools", () => {
    expect(rateLaneTools()).toHaveLength(4);
  });

  it("contains Bash, Glob, Grep, and Read", () => {
    const names = new Set(rateLaneTools().map((t) => t.function.name));
    expect(names).toContain("bash");
    expect(names).toContain("Glob");
    expect(names).toContain("Grep");
    expect(names).toContain("Read");
  });

  it("does not contain Edit", () => {
    const names = rateLaneTools().map((t) => t.function.name);
    expect(names).not.toContain("Edit");
  });

  it("does not contain any skill name", () => {
    const names = rateLaneTools().map((t) => t.function.name);
    for (const skillName of SKILL_NAMES) {
      expect(names).not.toContain(skillName);
    }
  });
});

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
