import { describe, expect, it } from "vitest";
import {
  boundaryCaseAlarms,
  caseAlarms,
  decideEscalation,
  isAtCeiling,
  isDemotedForModel,
} from "./verdict.js";

describe("decideEscalation", () => {
  describe("at the 2/3 floor (inclusive) but not a clean sweep", () => {
    it("still escalates at 2/3 — cleared the floor but unresolved", () => {
      expect(decideEscalation(2, 3)).toEqual({ escalate: true, additionalTrials: 3 });
    });
  });

  describe("below the 2/3 floor", () => {
    it("escalates at 1/3, needing 3 more trials to reach 6", () => {
      expect(decideEscalation(1, 3)).toEqual({ escalate: true, additionalTrials: 3 });
    });

    it("escalates at 0/3", () => {
      expect(decideEscalation(0, 3)).toEqual({ escalate: true, additionalTrials: 3 });
    });
  });

  describe("a clean sweep", () => {
    it("does not escalate when every trial passes", () => {
      expect(decideEscalation(3, 3)).toEqual({ escalate: false, additionalTrials: 0 });
    });
  });

  describe("already at or past the escalated total", () => {
    it("does not escalate at 9/10 — past the escalated total despite being unresolved", () => {
      expect(decideEscalation(9, 10)).toEqual({ escalate: false, additionalTrials: 0 });
    });

    it("does not escalate at 5/10 — below the floor, but no headroom left", () => {
      expect(decideEscalation(5, 10)).toEqual({ escalate: false, additionalTrials: 0 });
    });

    it("does not escalate at 4/6 — exactly at the escalated total, unresolved but out of headroom", () => {
      expect(decideEscalation(4, 6)).toEqual({ escalate: false, additionalTrials: 0 });
    });
  });

  it("escalates when no trials ran at all", () => {
    expect(decideEscalation(0, 0)).toEqual({ escalate: true, additionalTrials: 6 });
  });
});

describe("caseAlarms", () => {
  describe("normal case, boundaries pinned at both trial counts", () => {
    it("clears at 2/3", () => {
      expect(caseAlarms({ passed: 2, total: 3, hardFailed: false, observational: false })).toBe(
        false,
      );
    });

    it("alarms at 1/3", () => {
      expect(caseAlarms({ passed: 1, total: 3, hardFailed: false, observational: false })).toBe(
        true,
      );
    });

    it("clears at 4/6 after escalation", () => {
      expect(caseAlarms({ passed: 4, total: 6, hardFailed: false, observational: false })).toBe(
        false,
      );
    });

    it("alarms at 3/6 after escalation", () => {
      expect(caseAlarms({ passed: 3, total: 6, hardFailed: false, observational: false })).toBe(
        true,
      );
    });
  });

  describe("hard-failed trial", () => {
    it("alarms regardless of an otherwise-clearing rate", () => {
      expect(caseAlarms({ passed: 3, total: 3, hardFailed: true, observational: false })).toBe(
        true,
      );
    });

    it("alarms an observational case too — the override beats the observational marking", () => {
      expect(caseAlarms({ passed: 3, total: 3, hardFailed: true, observational: true })).toBe(true);
    });
  });

  describe("no trials at all", () => {
    it("alarms rather than clearing — zero trials is a harness fault, not a pass", () => {
      expect(caseAlarms({ passed: 0, total: 0, hardFailed: false, observational: false })).toBe(
        true,
      );
    });
  });

  describe("observational marking", () => {
    it("never alarms on a below-floor rate alone", () => {
      expect(caseAlarms({ passed: 1, total: 3, hardFailed: false, observational: true })).toBe(
        false,
      );
    });

    it("still doesn't alarm at a passing rate", () => {
      expect(caseAlarms({ passed: 3, total: 3, hardFailed: false, observational: true })).toBe(
        false,
      );
    });
  });
});

describe("isDemotedForModel", () => {
  it("is false when the case carries no marker at all", () => {
    expect(isDemotedForModel(undefined, "anthropic/claude-haiku-4.5")).toBe(false);
  });

  it("is true when the marker names the active model", () => {
    expect(isDemotedForModel(["anthropic/claude-haiku-4.5"], "anthropic/claude-haiku-4.5")).toBe(
      true,
    );
  });

  it("is false when the marker names a different model than the active one", () => {
    expect(isDemotedForModel(["google/gemini-2.5-flash"], "anthropic/claude-haiku-4.5")).toBe(
      false,
    );
  });

  it("is true when the active model is one of several named models", () => {
    expect(
      isDemotedForModel(
        ["google/gemini-2.5-flash", "anthropic/claude-haiku-4.5"],
        "anthropic/claude-haiku-4.5",
      ),
    ).toBe(true);
  });

  it("is false for an empty model list", () => {
    expect(isDemotedForModel([], "anthropic/claude-haiku-4.5")).toBe(false);
  });
});

describe("boundaryCaseAlarms", () => {
  it("does not alarm when every trial stayed clean", () => {
    expect(boundaryCaseAlarms({ allClean: true, demoted: false })).toBe(false);
  });

  it("alarms on a dirty trial when not demoted", () => {
    expect(boundaryCaseAlarms({ allClean: false, demoted: false })).toBe(true);
  });

  it("does not alarm on a dirty trial when demoted", () => {
    expect(boundaryCaseAlarms({ allClean: false, demoted: true })).toBe(false);
  });

  it("does not alarm when clean and demoted — demotion alone is not what clears it", () => {
    expect(boundaryCaseAlarms({ allClean: true, demoted: true })).toBe(false);
  });
});

describe("isAtCeiling", () => {
  it("is true for an observational case that passed every trial", () => {
    expect(isAtCeiling({ passed: 3, total: 3, observational: true })).toBe(true);
  });

  it("is false for an observational case with any failing trial", () => {
    expect(isAtCeiling({ passed: 2, total: 3, observational: true })).toBe(false);
  });

  it("is false for a non-observational case, even at a perfect rate", () => {
    expect(isAtCeiling({ passed: 3, total: 3, observational: false })).toBe(false);
  });

  it("is false when there are no trials to have passed", () => {
    expect(isAtCeiling({ passed: 0, total: 0, observational: true })).toBe(false);
  });
});
