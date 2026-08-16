import { describe, expect, it } from "vitest";
import { cannedToolResult } from "../harness/agentic-loop.js";
import type { ToolCall } from "../harness/call-model.js";
import { GATING_MODELS } from "../harness/config.js";
import { loadFixture } from "../harness/fixtures.js";
import { SUBCOMMAND_MUTABILITY } from "../harness/grade.js";
import { isDemotedForModel } from "../harness/verdict.js";
import {
  type BoundaryCase,
  CASES,
  type FrontLoadedCase,
  isBoundaryCase,
  isFrontLoadedCase,
  isOpCase,
  isProgressiveOpCase,
  type ObservationalMarker,
  validateCases,
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

    it("caps each roster model at 2 cases demoted for it — a larger count is a design smell", () => {
      for (const model of GATING_MODELS) {
        const demotedCount = CASES.filter((c) =>
          isDemotedForModel(c.observational?.models, model.id),
        ).length;
        expect(
          demotedCount,
          `"${model.id}" has ${demotedCount} cases demoted for it, more than the cap of 2`,
        ).toBeLessThanOrEqual(2);
      }
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

    it("classifies every progressive-op and front-loaded case as an op case, and no boundary case", () => {
      const opCases = CASES.filter(isOpCase);
      expect(opCases.some(isBoundaryCase)).toBe(false);
      expect(opCases.length).toBe(CASES.length - CASES.filter(isBoundaryCase).length);
    });

    it("classifies every case as exactly one of progressive-op, boundary, or front-loaded", () => {
      for (const c of CASES) {
        const matches = [isProgressiveOpCase(c), isBoundaryCase(c), isFrontLoadedCase(c)].filter(
          Boolean,
        ).length;
        expect(matches, `Case "${c.name}" matched ${matches} of the three predicates, want 1`).toBe(
          1,
        );
      }
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
    // The rung exists to show a model still converts under deep momentum. A
    // read-only op only has to be reached; a mutating one has to be committed
    // to, which is the harder half — so losing either kind hollows the rung out
    // even while cases remain. Asserted by mutability rather than by naming
    // specific commands, so retiring one case does not silently drop a whole
    // side of the rung.
    it.each([
      "mutating",
      "read-only",
    ] as const)("keeps a deep, gating trigger case for a %s op", (mutability) => {
      const deepCases = CASES.filter(isProgressiveOpCase).filter(
        (c) =>
          c.momentumTurns !== undefined &&
          c.momentumTurns >= 3 &&
          SUBCOMMAND_MUTABILITY[c.expect.command] === mutability,
      );
      expect(
        deepCases.length,
        `Expected a pressured buried trigger case for a ${mutability} op`,
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

  describe("observational marker validation", () => {
    const knownModelId = GATING_MODELS[0]?.id;
    if (knownModelId === undefined) {
      throw new Error("GATING_MODELS must not be empty for this test to run");
    }

    function caseWithMarker(observational: ObservationalMarker | undefined): FrontLoadedCase {
      return {
        name: "test-case",
        exposure: "front-loaded",
        task: "irrelevant",
        expect: { command: "search-text" },
        observational,
      };
    }

    function boundaryCaseWithMarker(observational: ObservationalMarker | undefined): BoundaryCase {
      return {
        name: "test-boundary-case",
        exposure: "progressive",
        task: "irrelevant",
        expect: { skill: "bash" },
        observational,
      };
    }

    it("accepts a marker naming a known roster model", () => {
      expect(() =>
        validateCases([
          caseWithMarker({ since: "2026-08-08", reason: "measured rate", models: [knownModelId] }),
        ]),
      ).not.toThrow();
    });

    it("does nothing for a case without a marker", () => {
      expect(() => validateCases([caseWithMarker(undefined)])).not.toThrow();
    });

    it("rejects an empty models list, naming the case", () => {
      expect(() =>
        validateCases([
          caseWithMarker({ since: "2026-08-08", reason: "measured rate", models: [] }),
        ]),
      ).toThrow('"test-case"');
    });

    it("rejects a model id absent from the roster, naming the case and the offending id", () => {
      expect(() =>
        validateCases([
          caseWithMarker({
            since: "2026-08-08",
            reason: "measured rate",
            models: ["not-a-real-model"],
          }),
        ]),
      ).toThrow(/"test-case".*not-a-real-model/s);
    });

    it("rejects a since value that isn't YYYY-MM-DD", () => {
      expect(() =>
        validateCases([
          caseWithMarker({ since: "08-08-2026", reason: "measured rate", models: [knownModelId] }),
        ]),
      ).toThrow('"test-case"');
    });

    it("rejects a blank reason", () => {
      expect(() =>
        validateCases([
          caseWithMarker({ since: "2026-08-08", reason: "   ", models: [knownModelId] }),
        ]),
      ).toThrow('"test-case"');
    });

    it("validates a boundary case's marker too, not just an op case's", () => {
      expect(() =>
        validateCases([
          boundaryCaseWithMarker({
            since: "2026-08-08",
            reason: "measured rate",
            models: ["not-a-real-model"],
          }),
        ]),
      ).toThrow(/"test-boundary-case".*not-a-real-model/s);
    });

    it("accepts a boundary case carrying a marker for a known roster model", () => {
      expect(() =>
        validateCases([
          boundaryCaseWithMarker({
            since: "2026-08-08",
            reason: "measured rate",
            models: [knownModelId],
          }),
        ]),
      ).not.toThrow();
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
