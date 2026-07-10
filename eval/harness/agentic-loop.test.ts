import { describe, expect, it } from "vitest";
import { loadFixture } from "../cases/cases.js";
import {
  boundaryTrialClean,
  cannedToolResult,
  type ModelStep,
  runAgenticLoop,
} from "./agentic-loop.js";
import type { ChatMessage, ModelResponse, ToolCall } from "./call-model.js";
import { SKILL_NAMES } from "./context.js";
import { BASH_TOOL, COMPETING_TOOLS } from "./tools.js";

const tc = (name: string): ToolCall => ({ name, arguments: {} });
const bashCall = (command: string): ToolCall => ({ name: "bash", arguments: { command } });
const resp = (...names: string[]): ModelResponse => ({ toolCalls: names.map(tc), text: "" });

/** A model that returns the given responses in order, counting its invocations. */
function scriptedModel(responses: ModelResponse[]): { step: ModelStep; callCount: () => number } {
  let calls = 0;
  const step: ModelStep = async () => {
    const response = responses[calls];
    calls += 1;
    return response;
  };
  return { step, callCount: () => calls };
}

describe("runAgenticLoop", () => {
  describe("match predicate", () => {
    it("reports a match when the predicate is satisfied after a precursor", async () => {
      const { step } = scriptedModel([resp("weaver-code-inspection"), resp("weaver-refactor")]);

      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 3,
        step,
        cannedResultFor: () => "result",
      });

      expect(result.matched).toBe(true);
      expect(result.matchedAtStep).toBe(2);
      expect(result.trail.map((t) => t.name)).toEqual([
        "weaver-code-inspection",
        "weaver-refactor",
      ]);
    });

    it("reports a match at step 1 when the predicate is satisfied on the first call", async () => {
      const { step } = scriptedModel([resp("weaver-refactor")]);

      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 3,
        step,
        cannedResultFor: () => "result",
      });

      expect(result.matched).toBe(true);
      expect(result.matchedAtStep).toBe(1);
    });

    it("reports no match and stops at the budget when the predicate is never satisfied", async () => {
      let calls = 0;
      const step: ModelStep = async () => {
        calls += 1;
        return resp("Grep");
      };

      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 3,
        step,
        cannedResultFor: () => "result",
      });

      expect(result.matched).toBe(false);
      expect(result.matchedAtStep).toBeUndefined();
      expect(result.steps).toBe(3);
      expect(calls).toBe(3);
      expect(result.trail.map((t) => t.name)).toEqual(["Grep", "Grep", "Grep"]);
    });

    it("stops and reports no match when the model emits no tool call", async () => {
      const { step, callCount } = scriptedModel([
        resp("Grep"),
        { toolCalls: [], text: "I'll just edit it by hand." },
      ]);

      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 3,
        step,
        cannedResultFor: () => "result",
      });

      expect(result.matched).toBe(false);
      expect(result.steps).toBe(2);
      expect(callCount()).toBe(2);
      expect(result.abandonedText).toBe("I'll just edit it by hand.");
    });

    it("leaves abandonedText unset when the run matches or exhausts the budget", async () => {
      const matched = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 3,
        step: async () => resp("weaver-refactor"),
        cannedResultFor: () => "result",
      });
      expect(matched.abandonedText).toBeUndefined();

      const exhausted = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 2,
        step: async () => resp("Grep"),
        cannedResultFor: () => "result",
      });
      expect(exhausted.abandonedText).toBeUndefined();
    });

    it("feeds the canned result back as plain-text turns, never tool-format messages", async () => {
      const histories: ChatMessage[][] = [];
      let calls = 0;
      const step: ModelStep = async (messages) => {
        histories.push(messages.map((m) => ({ ...m })));
        calls += 1;
        return calls === 1 ? resp("Grep") : resp("weaver-refactor");
      };

      await runAgenticLoop({
        messages: [{ role: "user", content: "task" }],
        tools: [],
        matches: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 3,
        step,
        cannedResultFor: (call) => `CANNED(${call.name})`,
      });

      const secondTurn = histories[1];
      const assistantEcho = secondTurn.find(
        (m) =>
          m.role === "assistant" && typeof m.content === "string" && m.content.includes("Grep"),
      );
      const cannedTurn = secondTurn.find(
        (m) =>
          m.role === "user" && typeof m.content === "string" && m.content.includes("CANNED(Grep)"),
      );
      expect(
        assistantEcho,
        "the prior call must be echoed as an assistant text turn",
      ).toBeDefined();
      expect(
        cannedTurn,
        "second turn must carry the canned result as a user message",
      ).toBeDefined();
      expect(secondTurn.every((m) => m.tool_calls === undefined)).toBe(true);
    });
  });

  describe("malformed tool-call arguments", () => {
    it("feeds an error back for a call with invalid arguments and lets the model retry", async () => {
      const invalidCall: ToolCall = {
        name: "bash",
        arguments: {},
        invalidArguments: '{"command":"unterminated',
      };
      const histories: ChatMessage[][] = [];
      let calls = 0;
      const step: ModelStep = async (messages) => {
        histories.push(messages.map((m) => ({ ...m })));
        calls += 1;
        return calls === 1 ? { toolCalls: [invalidCall], text: "" } : resp("weaver-refactor");
      };

      const result = await runAgenticLoop({
        messages: [{ role: "user", content: "task" }],
        tools: [],
        matches: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 3,
        step,
        cannedResultFor: () => {
          throw new Error("must not consult canned results for an invalid call");
        },
      });

      expect(result.matched).toBe(true);
      expect(result.matchedAtStep).toBe(2);
      expect(result.trail[0]).toBe(invalidCall);
      const errorTurn = histories[1].find(
        (m) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          m.content.includes("not valid JSON") &&
          m.content.includes('{"command":"unterminated'),
      );
      expect(errorTurn, "the malformed call must be answered with an error turn").toBeDefined();
    });
  });

  describe("SKILL.md read tracking", () => {
    it("credits skill SKILL.md read, excludes it from trail, and matches at a later step", async () => {
      const skillReadCall = tc("Read");
      const bashCall = tc("bash");

      const { step } = scriptedModel([
        { toolCalls: [skillReadCall], text: "" },
        { toolCalls: [bashCall], text: "" },
      ]);

      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "bash",
        isSkillMdRead: (call) => call === skillReadCall,
        maxSteps: 3,
        step,
        cannedResultFor: () => "result",
      });

      expect(result.matched).toBe(true);
      expect(result.matchedAtStep).toBe(2);
      expect(result.skillMdRead).toBe(true);
      expect(result.readTurn).toBe(1);
      expect(result.trail.map((t) => t.name)).not.toContain("Read");
      expect(result.trail.map((t) => t.name)).toContain("bash");
    });

    it("matches with no prior skill SKILL.md read", async () => {
      const bashCall = tc("bash");
      const { step } = scriptedModel([{ toolCalls: [bashCall], text: "" }]);

      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "bash",
        isSkillMdRead: () => false,
        maxSteps: 3,
        step,
        cannedResultFor: () => "result",
      });

      expect(result.matched).toBe(true);
      expect(result.skillMdRead).toBe(false);
      expect(result.readTurn).toBeUndefined();
    });

    it("reports skill SKILL.md read but no match when budget exhausted before a match", async () => {
      const skillReadCall = tc("Read");
      let callIndex = 0;
      const step: ModelStep = async () => {
        callIndex += 1;
        return callIndex === 1 ? { toolCalls: [skillReadCall], text: "" } : resp("Grep");
      };

      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "bash",
        isSkillMdRead: (call) => call === skillReadCall,
        maxSteps: 2,
        step,
        cannedResultFor: () => "result",
      });

      expect(result.matched).toBe(false);
      expect(result.skillMdRead).toBe(true);
      expect(result.readTurn).toBe(1);
      expect(result.trail.map((t) => t.name)).toEqual(["Grep"]);
    });

    it("records a non-matching competing call in the trail", async () => {
      const grepCall = tc("Grep");
      const { step } = scriptedModel([
        { toolCalls: [grepCall], text: "" },
        { toolCalls: [], text: "Done." },
      ]);

      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "bash",
        isSkillMdRead: () => false,
        maxSteps: 3,
        step,
        cannedResultFor: () => "result",
      });

      expect(result.matched).toBe(false);
      expect(result.trail.map((t) => t.name)).toEqual(["Grep"]);
    });

    it("records the first SKILL.md read turn and ignores subsequent reads", async () => {
      const skillReadCall1 = tc("Read");
      const skillReadCall2 = tc("Read");
      const bashCall = tc("bash");

      const { step } = scriptedModel([
        { toolCalls: [skillReadCall1], text: "" },
        { toolCalls: [skillReadCall2], text: "" },
        { toolCalls: [bashCall], text: "" },
      ]);

      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "bash",
        isSkillMdRead: (call) => call === skillReadCall1 || call === skillReadCall2,
        maxSteps: 4,
        step,
        cannedResultFor: () => "result",
      });

      expect(result.skillMdRead).toBe(true);
      expect(result.readTurn).toBe(1);
      expect(result.matched).toBe(true);
      expect(result.trail.map((t) => t.name)).not.toContain("Read");
    });
  });
});

describe("boundaryTrialClean", () => {
  it.each([
    {
      name: "a non-weaver bash command with no skill load",
      skillMdRead: false,
      trail: [bashCall("ls -la /tmp/weaver-eval/src")],
      expected: true,
    },
    {
      name: "an empty trail with no skill load",
      skillMdRead: false,
      trail: [] as ToolCall[],
      expected: true,
    },
    {
      name: "a skill load with an otherwise empty trail",
      skillMdRead: true,
      trail: [] as ToolCall[],
      expected: false,
    },
    {
      name: "a weaver invocation for any subcommand",
      skillMdRead: false,
      trail: [bashCall('weaver move-file \'{"oldPath":"a.ts"}\'')],
      expected: false,
    },
  ])("returns $expected for $name", ({ skillMdRead, trail, expected }) => {
    expect(boundaryTrialClean({ skillMdRead, trail })).toBe(expected);
  });
});

describe("cannedToolResult", () => {
  const laneToolNames = [
    ...SKILL_NAMES,
    ...COMPETING_TOOLS.map((t) => t.function.name),
    BASH_TOOL.function.name,
  ];

  const GENERIC_FILE_LIST = "src/auth.ts\nsrc/api.ts\nsrc/utils.ts";
  const GREP_STUB = "src/auth.ts:12:  userId\nsrc/api.ts:8:  userId";

  it.each(laneToolNames)("returns a non-empty canned result for %s", (name) => {
    expect(cannedToolResult(tc(name))).toBeTruthy();
  });

  it("throws for an unknown tool name", () => {
    expect(() => cannedToolResult(tc("unknownTool"))).toThrow(/unknownTool/);
  });

  describe("weaver bash calls", () => {
    it("resolves to the fixture-backed default when no case override exists", () => {
      const result = cannedToolResult(bashCall('weaver rename \'{"newName":"accountId"}\''));
      expect(result).toBe(loadFixture("rename"));
    });

    it("prefers a per-case override over the fixture default", () => {
      const result = cannedToolResult(bashCall("weaver rename '{}'"), { rename: "CUSTOM STUB" });
      expect(result).toBe("CUSTOM STUB");
    });

    it("throws for an unmapped weaver subcommand rather than falling back to the file list", () => {
      expect(() => cannedToolResult(bashCall("weaver bogus-command '{}'"))).toThrow(
        /No weaver stub for subcommand "bogus-command"/,
      );
    });

    it("never returns the generic bash file list for a weaver call", () => {
      const result = cannedToolResult(bashCall("weaver rename '{}'"));
      expect(result).not.toBe(GENERIC_FILE_LIST);
    });
  });

  describe("non-weaver bash calls", () => {
    it("returns the generic file list when no case override exists", () => {
      expect(cannedToolResult(bashCall("mkdir -p /tmp/weaver-eval/src/generated"))).toBe(
        GENERIC_FILE_LIST,
      );
    });

    it("prefers a per-case override over the generic file list", () => {
      const result = cannedToolResult(bashCall("ls -la"), { bash: "CUSTOM BASH STUB" });
      expect(result).toBe("CUSTOM BASH STUB");
    });
  });

  describe("non-bash tools with a case override", () => {
    it("prefers the case override over the global canned result", () => {
      const result = cannedToolResult(tc("Grep"), { Grep: "CUSTOM GREP STUB" });
      expect(result).toBe("CUSTOM GREP STUB");
    });

    it("falls back to the global canned result when the case has no override", () => {
      expect(cannedToolResult(tc("Grep"), { Read: "unrelated" })).toBe(GREP_STUB);
    });
  });
});
