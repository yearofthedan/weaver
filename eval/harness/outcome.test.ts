import { describe, expect, it } from "vitest";
import { classifyTrialOutcome, computeOutcomes } from "./outcome.js";

describe("classifyTrialOutcome", () => {
  it("classifies a match with no tool-style reach as a clean pass", () => {
    expect(
      classifyTrialOutcome({ matched: true, skillMdRead: true, skillCalledAsTool: false }),
    ).toBe("clean-pass");
  });

  it("classifies a match reached via a tool-style call as a warned pass", () => {
    expect(
      classifyTrialOutcome({ matched: true, skillMdRead: true, skillCalledAsTool: true }),
    ).toBe("warned-pass");
  });

  it("classifies a miss after a SKILL.md read as a content fail", () => {
    expect(
      classifyTrialOutcome({ matched: false, skillMdRead: true, skillCalledAsTool: false }),
    ).toBe("content-fail");
  });

  it("classifies a miss with no read at all as never reached", () => {
    expect(
      classifyTrialOutcome({ matched: false, skillMdRead: false, skillCalledAsTool: false }),
    ).toBe("never-reached");
  });

  it("classifies a clean match even when skillMdRead is somehow false", () => {
    expect(
      classifyTrialOutcome({ matched: true, skillMdRead: false, skillCalledAsTool: false }),
    ).toBe("clean-pass");
  });
});

describe("computeOutcomes", () => {
  it("returns all-zero counts and total for an empty trial set", () => {
    expect(computeOutcomes([])).toEqual({
      cleanPass: 0,
      warnedPass: 0,
      contentFail: 0,
      neverReached: 0,
      total: 0,
    });
  });

  it("tallies a single outcome into its own tier only", () => {
    expect(computeOutcomes(["clean-pass"])).toEqual({
      cleanPass: 1,
      warnedPass: 0,
      contentFail: 0,
      neverReached: 0,
      total: 1,
    });
  });

  it("tallies each tier independently across a mixed set", () => {
    expect(
      computeOutcomes([
        "clean-pass",
        "clean-pass",
        "warned-pass",
        "content-fail",
        "never-reached",
        "never-reached",
        "never-reached",
      ]),
    ).toEqual({
      cleanPass: 2,
      warnedPass: 1,
      contentFail: 1,
      neverReached: 3,
      total: 7,
    });
  });
});
