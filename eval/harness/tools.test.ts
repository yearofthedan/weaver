import { describe, expect, it } from "vitest";
import { SKILL_NAMES } from "./context.js";
import { BASH_TOOL, COMPETING_TOOLS } from "./tools.js";

describe("COMPETING_TOOLS", () => {
  describe("composition", () => {
    it("contains exactly four tools", () => {
      expect(COMPETING_TOOLS).toHaveLength(4);
    });

    it("names the four expected competitor tools", () => {
      const names = COMPETING_TOOLS.map((t) => t.function.name);
      expect(names).toContain("Edit");
      expect(names).toContain("Grep");
      expect(names).toContain("Glob");
      expect(names).toContain("Read");
    });

    it("uses function type for all entries", () => {
      for (const tool of COMPETING_TOOLS) {
        expect(tool.type).toBe("function");
      }
    });

    it("each tool has a non-empty description", () => {
      for (const tool of COMPETING_TOOLS) {
        expect(tool.function.description.length).toBeGreaterThan(0);
      }
    });

    it("each tool has a parameters schema", () => {
      for (const tool of COMPETING_TOOLS) {
        expect(tool.function.parameters).toBeDefined();
        expect(typeof tool.function.parameters).toBe("object");
      }
    });
  });

  describe("collision safety", () => {
    it("no competing tool name collides with any skill name", () => {
      const competingNames = COMPETING_TOOLS.map((t) => t.function.name);
      for (const skillName of SKILL_NAMES) {
        expect(competingNames).not.toContain(skillName);
      }
    });

    it("no competing tool name collides with the bash tool name", () => {
      const competingNames = COMPETING_TOOLS.map((t) => t.function.name);
      expect(competingNames).not.toContain(BASH_TOOL.function.name);
    });
  });
});
