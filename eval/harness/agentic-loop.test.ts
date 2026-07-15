import { describe, expect, it } from "vitest";
import { type ModelStep, runAgenticLoop } from "./agentic-loop.js";
import type { ChatMessage, ModelResponse, ToolCall } from "./call-model.js";

const tc = (name: string): ToolCall => ({ name, arguments: {} });
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

/**
 * A scripted model that also records a snapshot of the message history it was
 * called with on each turn, so a test can inspect exactly what the loop
 * replayed on a later turn.
 */
function recordingModel(responses: ModelResponse[]): {
  step: ModelStep;
  histories: ChatMessage[][];
} {
  const histories: ChatMessage[][] = [];
  let calls = 0;
  const step: ModelStep = async (messages) => {
    histories.push(messages.map((m) => ({ ...m })));
    const response = responses[calls];
    calls += 1;
    return response;
  };
  return { step, histories };
}

describe("runAgenticLoop", () => {
  describe("match predicate", () => {
    it.each([
      {
        name: "after a precursor",
        responses: [resp("weaver-code-inspection"), resp("weaver-refactor")],
        expectedStep: 2,
        expectedTrail: ["weaver-code-inspection", "weaver-refactor"],
      },
      {
        name: "on the first call",
        responses: [resp("weaver-refactor")],
        expectedStep: 1,
        expectedTrail: ["weaver-refactor"],
      },
    ])("reports a match $name", async ({ responses, expectedStep, expectedTrail }) => {
      const { step } = scriptedModel(responses);

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
      expect(result.matchedAtStep).toBe(expectedStep);
      expect(result.trail.map((t) => t.name)).toEqual(expectedTrail);
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

    it("matches when only one call in a multi-call turn satisfies the predicate, without waiting for the rest", async () => {
      const { step } = scriptedModel([resp("Grep", "weaver-refactor"), resp("Grep")]);

      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 2,
        step,
        cannedResultFor: () => "result",
      });

      expect(result.matched).toBe(true);
      expect(result.matchedAtStep).toBe(1);
      expect(result.steps).toBe(1);
    });

    it.each([
      { name: "matches", maxSteps: 3, responseName: "weaver-refactor" },
      { name: "exhausts the budget", maxSteps: 2, responseName: "Grep" },
    ])("leaves abandonedText unset when the run $name", async ({ maxSteps, responseName }) => {
      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps,
        step: async () => resp(responseName),
        cannedResultFor: () => "result",
      });
      expect(result.abandonedText).toBeUndefined();
    });
  });

  describe("hard-fail predicate", () => {
    it("stops at a hard-failing call after a read-only precursor: no match, failedAtStep set, call in trail", async () => {
      const { step } = scriptedModel([resp("weaver-code-inspection"), resp("weaver-refactor")]);

      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-search-and-replace",
        hardFails: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 5,
        step,
        cannedResultFor: () => "result",
      });

      expect(result.matched).toBe(false);
      expect(result.failedAtStep).toBe(2);
      expect(result.steps).toBe(2);
      expect(result.steps).toBeLessThan(5);
      expect(result.trail.map((t) => t.name)).toEqual([
        "weaver-code-inspection",
        "weaver-refactor",
      ]);
    });

    it("prefers a match over a hard fail when a call satisfies both predicates", async () => {
      const { step } = scriptedModel([resp("weaver-refactor")]);

      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-refactor",
        hardFails: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 3,
        step,
        cannedResultFor: () => "result",
      });

      expect(result.matched).toBe(true);
      expect(result.matchedAtStep).toBe(1);
      expect(result.failedAtStep).toBeUndefined();
    });

    it("hard-fails when only one call in a multi-call turn satisfies the veto, without waiting for the rest", async () => {
      const { step } = scriptedModel([resp("Grep", "weaver-refactor"), resp("Grep")]);

      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-search-and-replace",
        hardFails: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 2,
        step,
        cannedResultFor: () => "result",
      });

      expect(result.matched).toBe(false);
      expect(result.failedAtStep).toBe(1);
      expect(result.steps).toBe(1);
    });

    it("runs to the step budget when hardFails is omitted, even for a call a caller elsewhere would hard-fail on", async () => {
      let calls = 0;
      const step: ModelStep = async () => {
        calls += 1;
        return resp("weaver-refactor");
      };

      const result = await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-search-and-replace",
        isSkillMdRead: () => false,
        maxSteps: 3,
        step,
        cannedResultFor: () => "result",
      });

      expect(result.matched).toBe(false);
      expect(result.failedAtStep).toBeUndefined();
      expect(result.steps).toBe(3);
      expect(calls).toBe(3);
    });
  });

  describe("standard tool exchange", () => {
    it("replays the prior turn as an assistant tool_calls message plus a tool result per call", async () => {
      const { step, histories } = recordingModel([resp("Grep"), resp("weaver-refactor")]);

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
      const assistantEcho = secondTurn.find((m) => m.role === "assistant" && m.tool_calls);
      expect(assistantEcho?.tool_calls?.map((c) => c.name)).toEqual(["Grep"]);
      // No text this turn — assistant content is null, not a fabricated placeholder.
      expect(assistantEcho?.content).toBeNull();

      const callId = assistantEcho?.tool_calls?.[0].id;
      expect(callId).toBeDefined();

      const toolResult = secondTurn.find((m) => m.role === "tool");
      expect(toolResult?.tool_call_id).toBe(callId);
      expect(toolResult?.content).toBe("CANNED(Grep)");
    });

    it("answers every call in a multi-call turn with its own id-matched tool result", async () => {
      const { step, histories } = recordingModel([resp("Grep", "Glob"), resp("weaver-refactor")]);

      await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 3,
        step,
        cannedResultFor: (call) => `CANNED(${call.name})`,
      });

      const secondTurn = histories[1];
      const assistant = secondTurn.find((m) => m.role === "assistant" && m.tool_calls);
      const toolResults = secondTurn.filter((m) => m.role === "tool");
      const callIds = assistant?.tool_calls?.map((c) => c.id) ?? [];

      expect(callIds).toHaveLength(2);
      expect(toolResults.map((m) => m.tool_call_id)).toEqual(callIds);
      expect(toolResults.map((m) => m.content)).toEqual(["CANNED(Grep)", "CANNED(Glob)"]);
    });

    it("preserves a call's own id in the echoed exchange rather than overwriting it with a generated one", async () => {
      const callWithId: ToolCall = { id: "provider-issued-id", name: "Grep", arguments: {} };
      const { step, histories } = recordingModel([
        { toolCalls: [callWithId], text: "" },
        resp("weaver-refactor"),
      ]);

      await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 3,
        step,
        cannedResultFor: () => "result",
      });

      const secondTurn = histories[1];
      const assistantEcho = secondTurn.find((m) => m.role === "assistant" && m.tool_calls);
      expect(assistantEcho?.tool_calls?.[0].id).toBe("provider-issued-id");
      const toolResult = secondTurn.find((m) => m.role === "tool");
      expect(toolResult?.tool_call_id).toBe("provider-issued-id");
    });

    it("carries the model's text as assistant content when it emitted some", async () => {
      const { step, histories } = recordingModel([
        { toolCalls: [tc("Grep")], text: "Let me search first." },
        resp("weaver-refactor"),
      ]);

      await runAgenticLoop({
        messages: [],
        tools: [],
        matches: (call) => call.name === "weaver-refactor",
        isSkillMdRead: () => false,
        maxSteps: 3,
        step,
        cannedResultFor: () => "result",
      });

      const assistant = histories[1].find((m) => m.role === "assistant" && m.tool_calls);
      expect(assistant?.content).toBe("Let me search first.");
    });
  });

  describe("malformed tool-call arguments", () => {
    it("feeds an error back for a call with invalid arguments and lets the model retry", async () => {
      const invalidCall: ToolCall = {
        name: "bash",
        arguments: {},
        invalidArguments: '{"command":"unterminated',
      };
      const { step, histories } = recordingModel([
        { toolCalls: [invalidCall], text: "" },
        resp("weaver-refactor"),
      ]);

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
          m.role === "tool" &&
          typeof m.content === "string" &&
          m.content.includes("not valid JSON") &&
          m.content.includes('{"command":"unterminated'),
      );
      expect(
        errorTurn,
        "the malformed call must be answered with an error tool result",
      ).toBeDefined();
    });
  });

  describe("SKILL.md read tracking", () => {
    const bashCall = tc("bash");

    it("credits skill SKILL.md read, excludes it from trail, and matches at a later step", async () => {
      const skillReadCall = tc("Read");

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
