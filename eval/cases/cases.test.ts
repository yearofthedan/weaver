import { describe, expect, it } from "vitest";
import { cannedToolResult } from "../harness/agentic-loop.js";
import type { ToolCall } from "../harness/call-model.js";
import { loadFixture } from "../harness/fixtures.js";
import {
  CASES,
  isBoundaryCase,
  isFrontLoadedCase,
  isProgressiveOpCase,
  type OpCase,
} from "./cases.js";

function bashCall(command: string): ToolCall {
  return { name: "bash", arguments: { command } };
}

describe("case table", () => {
  describe("structure invariants", () => {
    it("no two cases share the same name", () => {
      const names = CASES.map((c) => c.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });

    it("every two-step-named case is front-loaded with a seed", () => {
      const twoStepCases = CASES.filter((c) => c.name.startsWith("two-step"));
      expect(twoStepCases.length).toBeGreaterThan(0);
      for (const c of twoStepCases) {
        expect(isFrontLoadedCase(c), `Two-step case "${c.name}" must be front-loaded`).toBe(true);
        expect(
          isFrontLoadedCase(c) && c.seed,
          `Two-step case "${c.name}" is missing seed`,
        ).toBeDefined();
      }
    });

    it("marks at most a couple of cases observational — a larger list is a design smell", () => {
      const observational = CASES.filter(
        (c): c is OpCase => !isBoundaryCase(c) && c.observational !== undefined,
      );
      expect(observational.length).toBeLessThanOrEqual(2);
    });

    it("seeds every single-step front-loaded case with the 3-turn pressure the folded lane measured", () => {
      const singleStep = CASES.filter(isFrontLoadedCase).filter((c) => !c.seed);
      expect(singleStep.length).toBeGreaterThan(0);
      for (const c of singleStep) {
        expect(c.momentumTurns, `"${c.name}" should carry momentumTurns: 3`).toBe(3);
      }
    });

    it("leaves two-step front-loaded cases at the default momentum, not stacked on their scripted step-1 turn", () => {
      const twoStep = CASES.filter(isFrontLoadedCase).filter((c) => c.seed);
      expect(twoStep.length).toBeGreaterThan(0);
      for (const c of twoStep) {
        expect(
          c.momentumTurns,
          `"${c.name}" should not declare its own momentumTurns`,
        ).toBeUndefined();
      }
    });
  });

  describe("trigger coverage", () => {
    it("has at least one trigger case for the refactor skill", () => {
      const refactorTriggers = CASES.filter(isProgressiveOpCase).filter(
        (c) => c.expect.skill === "weaver-refactor",
      );
      expect(refactorTriggers.length).toBeGreaterThanOrEqual(1);
    });

    it("has at least one trigger case for the search-and-replace skill", () => {
      const searchTriggers = CASES.filter(isProgressiveOpCase).filter(
        (c) => c.expect.skill === "weaver-search-and-replace",
      );
      expect(searchTriggers.length).toBeGreaterThanOrEqual(1);
    });

    it("has at least one trigger case for the code-inspection skill", () => {
      const inspectionTriggers = CASES.filter(isProgressiveOpCase).filter(
        (c) => c.expect.skill === "weaver-code-inspection",
      );
      expect(inspectionTriggers.length).toBeGreaterThanOrEqual(1);
    });

    it("has at least one trigger case that tempts the model to use sed or grep instead", () => {
      const temptingCases = CASES.filter(
        (c) => c.exposure === "progressive" && (c.name.includes("sed") || c.name.includes("grep")),
      );
      expect(temptingCases.length).toBeGreaterThanOrEqual(1);
    });

    it("has at least one boundary case that must stay in bash", () => {
      const boundaryCases = CASES.filter(isBoundaryCase);
      expect(boundaryCases.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("adjacent-negative boundary cases", () => {
    it("has the adjacent-negative cases with distinct tasks, all gated to bash", () => {
      const names = ["boundary-bash-search-non-ts-project", "boundary-bash-remove-console-log"];
      const found = names.map((name) => CASES.find((c) => c.name === name));
      for (const [i, c] of found.entries()) {
        expect(c, `Expected boundary case "${names[i]}" to exist`).toBeDefined();
        expect(c !== undefined && isBoundaryCase(c)).toBe(true);
      }

      const tasks = found.map((c) => c?.task);
      expect(new Set(tasks).size).toBe(tasks.length);
    });
  });

  describe("pressured buried rung", () => {
    it.each([
      "rename",
      "replace-text",
      "find-references",
    ])("has a deep, gating trigger case for %s", (command) => {
      const pressuredCases = CASES.filter(isProgressiveOpCase).filter(
        (c) =>
          c.momentumTurns !== undefined && c.momentumTurns >= 3 && c.expect.command === command,
      );
      expect(
        pressuredCases.length,
        `Expected a pressured buried trigger case for "${command}"`,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  describe("cannedResults", () => {
    it("resolves the no-coords rename case's search-text override to the positional stub, not the file list", () => {
      const noCoordsCase = CASES.find(
        (c) => c.name === "trigger-refactor-rename-no-coords-sed-tempting",
      );
      expect(noCoordsCase?.cannedResults).toBeDefined();

      const result = cannedToolResult(
        bashCall('weaver search-text \'{"pattern":"userId"}\''),
        noCoordsCase?.cannedResults,
      );

      const parsed = JSON.parse(result) as { matches: Array<{ line: number; col: number }> };
      expect(parsed.matches).toHaveLength(1);
      expect(parsed.matches[0]).toMatchObject({ line: 12, col: 9 });
      expect(result).not.toBe("src/auth.ts\nsrc/api.ts\nsrc/utils.ts");
    });
  });

  describe("fixture loading", () => {
    it("loads a valid fixture by filename", () => {
      const content = loadFixture("rename.json");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      expect(parsed.status).toBe("success");
    });

    it("throws when the fixture file does not exist", () => {
      expect(() => loadFixture("nonExistent.json")).toThrow("nonExistent.json");
    });
  });
});
