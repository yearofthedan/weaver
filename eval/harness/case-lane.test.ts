import { afterEach, describe, expect, it } from "vitest";
import type { CaseEntry } from "../cases/cases.js";
import { seedForCase } from "./case-lane.js";

afterEach(() => {
  delete process.env.WEAVER_EVAL_CLEAN;
});

function baseCase(overrides: Partial<Pick<CaseEntry, "task" | "momentumTurns">> = {}): CaseEntry {
  return {
    name: "test-case",
    exposure: "progressive",
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

  describe("clean mode", () => {
    it("seeds no momentum turns when WEAVER_EVAL_CLEAN is '1', even though the default seeds one", () => {
      process.env.WEAVER_EVAL_CLEAN = "1";
      const messages = seedForCase(baseCase());
      expect(messages).toEqual([
        { role: "user", content: "rename the function processUser to handleAccount in src/" },
      ]);
    });

    it("overrides a case's own momentumTurns, not just the default", () => {
      process.env.WEAVER_EVAL_CLEAN = "1";
      const messages = seedForCase(baseCase({ momentumTurns: 3 }));
      expect(messages).toHaveLength(1);
    });

    it("still seeds momentum turns when WEAVER_EVAL_CLEAN is unset", () => {
      const messages = seedForCase(baseCase());
      expect(messages).toHaveLength(5);
    });
  });
});
