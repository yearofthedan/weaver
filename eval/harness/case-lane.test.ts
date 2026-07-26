import { afterEach, describe, expect, it } from "vitest";
import type {
  BoundaryCase,
  CaseEntry,
  FrontLoadedCase,
  ProgressiveOpCase,
} from "../cases/cases.js";
import type { ToolCall } from "./call-model.js";
import {
  buildTrialConfig,
  FRONT_LOADED_MAX_STEPS,
  PROGRESSIVE_MAX_STEPS,
  seedForCase,
  systemPromptFor,
} from "./case-lane.js";
import { buildClutterSystemPrompt } from "./clutter.js";
import { buildAvailableSkillsPrompt, readSkillFile } from "./context.js";
import { BASH_TOOL } from "./tools.js";

afterEach(() => {
  delete process.env.WEAVER_EVAL_CLEAN;
});

const tc = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
  name,
  arguments: args,
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

function progressiveCase(overrides: Partial<ProgressiveOpCase> = {}): ProgressiveOpCase {
  return {
    name: "progressive-test-case",
    exposure: "progressive",
    task: "rename `userId` to `accountId`",
    expect: { skill: "weaver-refactor", command: "rename", keyArgs: { newName: "accountId" } },
    ...overrides,
  };
}

function boundaryCase(overrides: Partial<BoundaryCase> = {}): BoundaryCase {
  return {
    name: "boundary-test-case",
    exposure: "progressive",
    task: "search for API_KEY in a python project",
    expect: { skill: "bash" },
    ...overrides,
  };
}

function frontLoadedCase(overrides: Partial<FrontLoadedCase> = {}): FrontLoadedCase {
  return {
    name: "front-loaded-test-case",
    exposure: "front-loaded",
    task: "rename `userId` to `accountId`",
    expect: { command: "rename", keyArgs: { newName: "accountId" } },
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

describe("systemPromptFor", () => {
  describe("progressive", () => {
    it("wraps clutter around the available-skills block", () => {
      const prompt = systemPromptFor("progressive");
      expect(prompt).toContain(buildClutterSystemPrompt());
      expect(prompt).toContain("<available_skills>");
    });

    it("drops clutter but keeps the available-skills block under clean mode", () => {
      process.env.WEAVER_EVAL_CLEAN = "1";
      const prompt = systemPromptFor("progressive");
      expect(prompt).toBe(buildAvailableSkillsPrompt());
      expect(prompt).not.toContain("Assistant Identity");
    });
  });

  describe("front-loaded", () => {
    it("is clutter only, with no available-skills block", () => {
      const prompt = systemPromptFor("front-loaded");
      expect(prompt).toBe(buildClutterSystemPrompt());
      expect(prompt).not.toContain("<available_skills>");
    });

    it("is empty under clean mode", () => {
      process.env.WEAVER_EVAL_CLEAN = "1";
      expect(systemPromptFor("front-loaded")).toBe("");
    });
  });
});

describe("buildTrialConfig", () => {
  describe("boundary case", () => {
    it("declares the skill tool plus the rate-lane tool set and a 6-step budget", () => {
      const config = buildTrialConfig(boundaryCase());
      const names = config.tools.map((t) => t.function.name);
      expect(names).toContain("Skill");
      expect(names).toContain("bash");
      expect(config.maxSteps).toBe(PROGRESSIVE_MAX_STEPS);
    });

    it("never matches — a boundary case has no expected command to converge on", () => {
      const config = buildTrialConfig(boundaryCase());
      expect(config.matches(tc("bash", { command: "weaver rename '{}'" }))).toBe(false);
    });

    it("opens with the clutter+skills system message, then the seeded task turn", () => {
      const config = buildTrialConfig(boundaryCase());
      expect(config.messages[0].role).toBe("system");
      expect(config.messages.at(-1)).toEqual({
        role: "user",
        content: "search for API_KEY in a python project",
      });
    });

    it("declares no hard-fail predicate — reaching any weaver op is judged by the clean check, not vetoed mid-trial", () => {
      const config = buildTrialConfig(boundaryCase());
      expect(config.hardFails).toBeUndefined();
    });
  });

  describe.each([
    { exposure: "progressive", buildCase: () => progressiveCase() },
    { exposure: "front-loaded", buildCase: () => frontLoadedCase() },
  ])("matches and hardFails — $exposure", ({ buildCase }) => {
    it("matches a bash call for the expected command with correct key args", () => {
      const config = buildTrialConfig(buildCase());
      const call = tc("bash", { command: `weaver rename '{"newName":"accountId"}'` });
      expect(config.matches(call)).toBe(true);
    });

    it("does not match when the key arg is wrong", () => {
      const config = buildTrialConfig(buildCase());
      const call = tc("bash", { command: `weaver rename '{"newName":"wrong"}'` });
      expect(config.matches(call)).toBe(false);
    });

    it("hard-fails on a different mutating weaver subcommand", () => {
      const config = buildTrialConfig(buildCase());
      const call = tc("bash", { command: `weaver move-file '{"oldPath":"a.ts"}'` });
      expect(config.hardFails?.(call)).toBe(true);
    });
  });

  describe("progressive op case", () => {
    it("feeds back the real SKILL.md body for a sanctioned skill load", () => {
      const config = buildTrialConfig(progressiveCase());
      const result = config.cannedResultFor(tc("Skill", { skill: "weaver-refactor" }));
      expect(result).toBe(readSkillFile("weaver-refactor"));
    });

    it("feeds back a host unknown-skill error for a bad Skill() name", () => {
      const config = buildTrialConfig(progressiveCase());
      const result = config.cannedResultFor(tc("Skill", { skill: "nonsense-skill" }));
      expect(result).toContain('unknown skill "nonsense-skill"');
    });

    it("feeds back a host no-such-tool error for a name matching no declared tool or skill", () => {
      const config = buildTrialConfig(progressiveCase());
      const result = config.cannedResultFor(tc("frobnicate"));
      expect(result).toContain('no such tool "frobnicate"');
    });

    it("resolves a declared competing tool to its canned result, not a no-such-tool error", () => {
      const config = buildTrialConfig(progressiveCase());
      const result = config.cannedResultFor(tc("Grep"));
      expect(result).not.toContain("no such tool");
    });

    it("counts a sanctioned Skill() load as a skill read, and an ordinary tool call as neither", () => {
      const config = buildTrialConfig(progressiveCase());
      expect(config.isSkillMdRead(tc("Skill", { skill: "weaver-refactor" }))).toBe(true);
      expect(config.isSkillCalledAsTool?.(tc("Skill", { skill: "weaver-refactor" }))).toBe(false);
      expect(config.isSkillMdRead(tc("bash", { command: "ls" }))).toBe(false);
      expect(config.isSkillCalledAsTool?.(tc("bash", { command: "ls" }))).toBe(false);
    });

    it("counts a skill invoked directly as a tool as both a read and a tool-style reach", () => {
      const config = buildTrialConfig(progressiveCase());
      expect(config.isSkillMdRead(tc("weaver_refactor"))).toBe(false);
      expect(config.isSkillCalledAsTool?.(tc("weaver_refactor"))).toBe(true);
    });

    it("reads a Read of a skill's SKILL.md as a sanctioned load", () => {
      const config = buildTrialConfig(progressiveCase());
      const call = tc("Read", { file: ".claude/skills/weaver-refactor/SKILL.md" });
      expect(config.isSkillMdRead(call)).toBe(true);
    });
  });

  describe("front-loaded case, single-step", () => {
    it("declares bash as the only tool, with a 3-step budget", () => {
      const config = buildTrialConfig(frontLoadedCase());
      expect(config.tools).toEqual([BASH_TOOL]);
      expect(config.maxSteps).toBe(FRONT_LOADED_MAX_STEPS);
    });

    it("puts the skill bodies in the single user turn via the command prompt, not a system skills block", () => {
      const config = buildTrialConfig(frontLoadedCase({ momentumTurns: 0 }));
      const taskTurn = config.messages.find((m) => m.role === "user");
      expect(taskTurn?.content).toContain(readSkillFile("weaver-refactor"));
      expect(
        config.messages.some(
          (m) => m.role === "system" && m.content?.includes("<available_skills>"),
        ),
      ).toBe(false);
    });

    it("treats an undeclared Skill() call as a hallucinated tool, not a skill load", () => {
      const config = buildTrialConfig(frontLoadedCase());
      const result = config.cannedResultFor(tc("Skill", { skill: "weaver-refactor" }));
      expect(result).toContain('no such tool "Skill"');
      expect(result).not.toBe(readSkillFile("weaver-refactor"));
    });

    it("names the declared tools in the no-such-tool error, so the model can correct itself", () => {
      const config = buildTrialConfig(frontLoadedCase());
      expect(config.cannedResultFor(tc("Skill"))).toContain("Available tools: bash.");
    });

    it("resolves a bash call to its canned result — bash is declared here, not hallucinated", () => {
      const config = buildTrialConfig(frontLoadedCase());
      const result = config.cannedResultFor(tc("bash", { command: "ls src/" }));
      expect(result).not.toContain("no such tool");
    });

    it("recognises no call as a skill read — the bodies are already in context", () => {
      const config = buildTrialConfig(frontLoadedCase());
      expect(config.isSkillMdRead(tc("Skill", { skill: "weaver-refactor" }))).toBe(false);
      expect(config.isSkillMdRead(tc("bash", { command: "ls" }))).toBe(false);
    });

    it("seeds the default one momentum turn before the task when momentumTurns is absent", () => {
      const config = buildTrialConfig(frontLoadedCase());
      const roles = config.messages.map((m) => m.role);
      // system, [momentum: user, assistant, tool, assistant], task user turn.
      expect(roles).toEqual(["system", "user", "assistant", "tool", "assistant", "user"]);
    });

    it("drops momentum and the system message under clean mode", () => {
      process.env.WEAVER_EVAL_CLEAN = "1";
      const config = buildTrialConfig(frontLoadedCase());
      expect(config.messages).toHaveLength(1);
      expect(config.messages[0].role).toBe("user");
    });
  });

  describe("front-loaded case, two-step", () => {
    function seededCase(): FrontLoadedCase {
      return frontLoadedCase({
        momentumTurns: 0,
        seed: { step1Command: `weaver search-text '{"pattern":"userId"}'`, fixture: "rename.json" },
      });
    }

    it("appends the scripted step-1 exchange after a single task turn, not duplicated or reordered", () => {
      const config = buildTrialConfig(seededCase());
      const roles = config.messages.map((m) => m.role);
      // system, task user turn, seeded assistant call, seeded tool result.
      expect(roles).toEqual(["system", "user", "assistant", "tool"]);

      const userTurns = config.messages.filter((m) => m.role === "user");
      expect(userTurns).toHaveLength(1);
    });

    it("the seeded assistant call runs the case's own step1Command, not the momentum pool's commands", () => {
      const config = buildTrialConfig(seededCase());
      const assistantTurn = config.messages.find((m) => m.role === "assistant");
      expect(assistantTurn?.tool_calls?.[0].arguments.command).toBe(
        `weaver search-text '{"pattern":"userId"}'`,
      );
    });

    it("composes momentum pre-steps before the task, still with the task appearing exactly once", () => {
      const config = buildTrialConfig({ ...seededCase(), momentumTurns: 2 });
      const roles = config.messages.map((m) => m.role);
      // system, momentum turn 1, momentum turn 2, task, seeded exchange.
      expect(roles).toEqual([
        "system",
        "user",
        "assistant",
        "tool",
        "assistant",
        "user",
        "assistant",
        "tool",
        "assistant",
        "user",
        "assistant",
        "tool",
      ]);
      const taskTurns = config.messages.filter((m) =>
        m.content?.includes(`Task: ${seededCase().task}`),
      );
      expect(taskTurns).toHaveLength(1);
    });
  });
});
