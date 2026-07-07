import { describe, expect, it } from "vitest";
import { CASES, loadFixture } from "./cases.js";

describe("case table", () => {
  describe("structure invariants", () => {
    it("every case declares at least one of tool or subcommand", () => {
      for (const c of CASES) {
        expect(
          c.expect.tool !== undefined || c.expect.subcommand !== undefined,
          `Case "${c.name}" declares neither expect.tool nor expect.subcommand`,
        ).toBe(true);
      }
    });

    it("every trigger case declares expect.tool", () => {
      const triggerCases = CASES.filter((c) => c.stage === "trigger");
      for (const c of triggerCases) {
        expect(c.expect.tool, `Trigger case "${c.name}" is missing expect.tool`).toBeDefined();
      }
    });

    it("every skill-trigger case declares expect.subcommand", () => {
      const skillTriggerCases = CASES.filter(
        (c) => c.stage === "trigger" && c.expect.tool !== "bash",
      );
      for (const c of skillTriggerCases) {
        expect(
          c.expect.subcommand,
          `Skill-trigger case "${c.name}" is missing expect.subcommand`,
        ).toBeDefined();
      }
    });

    it("every command case declares expect.subcommand", () => {
      const commandCases = CASES.filter((c) => c.stage === "command");
      for (const c of commandCases) {
        expect(
          c.expect.subcommand,
          `Command case "${c.name}" is missing expect.subcommand`,
        ).toBeDefined();
      }
    });

    it("no two cases share the same name", () => {
      const names = CASES.map((c) => c.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });

    it("every two-step case has a seed", () => {
      const twoStepCases = CASES.filter((c) => c.name.startsWith("two-step"));
      for (const c of twoStepCases) {
        expect(c.seed, `Two-step case "${c.name}" is missing seed`).toBeDefined();
      }
    });
  });

  describe("trigger coverage", () => {
    it("has at least one trigger case for the refactor skill", () => {
      const refactorTriggers = CASES.filter(
        (c) => c.stage === "trigger" && c.expect.tool === "weaver-refactor",
      );
      expect(refactorTriggers.length).toBeGreaterThanOrEqual(1);
    });

    it("has at least one trigger case for the search-and-replace skill", () => {
      const searchTriggers = CASES.filter(
        (c) => c.stage === "trigger" && c.expect.tool === "weaver-search-and-replace",
      );
      expect(searchTriggers.length).toBeGreaterThanOrEqual(1);
    });

    it("has at least one trigger case for the code-inspection skill", () => {
      const inspectionTriggers = CASES.filter(
        (c) => c.stage === "trigger" && c.expect.tool === "weaver-code-inspection",
      );
      expect(inspectionTriggers.length).toBeGreaterThanOrEqual(1);
    });

    it("has at least one trigger case that tempts the model to use sed or grep instead", () => {
      const temptingCases = CASES.filter(
        (c) => c.stage === "trigger" && (c.name.includes("sed") || c.name.includes("grep")),
      );
      expect(temptingCases.length).toBeGreaterThanOrEqual(1);
    });

    it("has at least one boundary case that must stay in bash", () => {
      const boundaryCases = CASES.filter((c) => c.stage === "trigger" && c.expect.tool === "bash");
      expect(boundaryCases.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("fixture loading", () => {
    it("loads a valid fixture by operation name", () => {
      const content = loadFixture("rename");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      expect(parsed.status).toBe("success");
    });

    it("throws when the operation name does not correspond to a fixture", () => {
      expect(() => loadFixture("nonExistentOperation")).toThrow("nonExistentOperation");
    });
  });
});
