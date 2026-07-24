import { describe, expect, it } from "vitest";
import type { CaseEntry } from "../cases/cases.js";
import { seedForCase } from "./case-lane.js";

function baseCase(overrides: Partial<CaseEntry> = {}): CaseEntry {
  return {
    name: "test-case",
    stage: "trigger",
    task: "rename the function processUser to handleAccount in src/",
    expect: { skill: "weaver-refactor", command: "rename" },
    ...overrides,
  };
}

describe("seedForCase", () => {
  describe("momentumTurns absent", () => {
    it("seeds exactly one true-shell turn, producing five messages", () => {
      const messages = seedForCase(baseCase());
      expect(messages).toHaveLength(5);
    });
  });

  describe("momentumTurns present", () => {
    it("seeds the requested number of turns", () => {
      const messages = seedForCase(baseCase({ momentumTurns: 3 }));
      expect(messages).toHaveLength(13);
    });
  });

  describe("task carry-through", () => {
    it("ends with the case's task verbatim", () => {
      const c = baseCase({ task: "a distinct task string" });
      const messages = seedForCase(c);
      expect(messages[messages.length - 1]).toEqual({
        role: "user",
        content: "a distinct task string",
      });
    });
  });
});
