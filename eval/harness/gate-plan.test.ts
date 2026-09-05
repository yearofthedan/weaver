import { describe, expect, it } from "vitest";
import type { GatingModel } from "./config.js";
import { buildGatePlans, extractRunCost } from "./gate-plan.js";

const ROSTER: readonly GatingModel[] = [
  { id: "anthropic/claude-haiku-4.5", baseTrials: 3 },
  { id: "google/gemini-2.5-flash", baseTrials: 10 },
];

describe("buildGatePlans", () => {
  it("builds one plan per roster model, in roster order", () => {
    const plans = buildGatePlans(ROSTER);

    expect(plans.map((p) => p.modelId)).toEqual([
      "anthropic/claude-haiku-4.5",
      "google/gemini-2.5-flash",
    ]);
  });

  it("uses each model's roster trial count when the caller set none", () => {
    const plans = buildGatePlans(ROSTER);

    expect(plans.map((p) => p.trials)).toEqual([3, 10]);
  });

  it("uses the roster trial count when WEAVER_EVAL_TRIALS is blank", () => {
    const plans = buildGatePlans(ROSTER, { trialsOverride: "" });

    expect(plans.map((p) => p.trials)).toEqual([3, 10]);
  });

  it("overrides every model's trial count with a caller-set WEAVER_EVAL_TRIALS", () => {
    const plans = buildGatePlans(ROSTER, { trialsOverride: "1" });

    expect(plans.map((p) => p.trials)).toEqual([1, 1]);
  });

  it.each(["abc", "0", "-1", "2.5"])(
    "rejects a WEAVER_EVAL_TRIALS override of %s rather than passing it to the child",
    (override) => {
      expect(() => buildGatePlans(ROSTER, { trialsOverride: override })).toThrow(
        /WEAVER_EVAL_TRIALS/,
      );
    },
  );

  it("always includes --disable-console-intercept in argv", () => {
    const plans = buildGatePlans(ROSTER);

    for (const plan of plans) {
      expect(plan.argv).toContain("--disable-console-intercept");
    }
  });

  it("forwards extra argv (e.g. a case filter) to every plan", () => {
    const plans = buildGatePlans(ROSTER, { extraArgv: ["-t", "command-find-references"] });

    for (const plan of plans) {
      expect(plan.argv).toEqual(
        expect.arrayContaining(["-t", "command-find-references", "--disable-console-intercept"]),
      );
    }
  });

  it("runs the eval script itself, not a re-specified vitest config", () => {
    const [plan] = buildGatePlans(ROSTER);

    expect(plan?.argv[0]).toBe("eval");
  });

  it("returns an empty list for an empty roster", () => {
    expect(buildGatePlans([])).toEqual([]);
  });
});

describe("extractRunCost", () => {
  it("extracts the cost from the run's reported cost line", () => {
    const output = [
      "eval run — model anthropic/claude-haiku-4.5 | trials 3",
      "command-find-references — rate 3/3",
      "eval run cost — $0.1234",
      "",
    ].join("\n");

    expect(extractRunCost(output)).toBe(0.1234);
  });

  it("finds the cost line among other output rather than requiring an exact match", () => {
    const output = "noise before\neval run cost — $1.5\nnoise after";

    expect(extractRunCost(output)).toBe(1.5);
  });

  it("returns undefined when no cost line is present — a crashed run has no cost to report", () => {
    const output = "Error: Hosted model endpoint not configured.\n";

    expect(extractRunCost(output)).toBeUndefined();
  });

  it("returns undefined for empty output", () => {
    expect(extractRunCost("")).toBeUndefined();
  });
});
