import { describe, expect, it } from "vitest";
import { cannedToolResult, type ModelStep, runAgenticLoop } from "./agentic-loop.js";
import type { ChatMessage, ModelResponse, ToolCall } from "./call-model.js";
import { SKILL_NAMES } from "./context.js";
import { BASH_TOOL, COMPETING_TOOLS } from "./tools.js";

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

describe("runAgenticLoop", () => {
  it("reports a match when the expected skill is reached after a precursor", async () => {
    const { step } = scriptedModel([resp("weaver-code-inspection"), resp("weaver-refactor")]);

    const result = await runAgenticLoop({
      messages: [],
      tools: [],
      expectedTool: "weaver-refactor",
      maxSteps: 3,
      step,
      cannedResultFor: () => "result",
    });

    expect(result.matched).toBe(true);
    expect(result.matchedAtStep).toBe(2);
    expect(result.trail.map((t) => t.name)).toEqual(["weaver-code-inspection", "weaver-refactor"]);
  });

  it("reports a match at step 1 when the expected skill is the first call", async () => {
    const { step } = scriptedModel([resp("weaver-refactor")]);

    const result = await runAgenticLoop({
      messages: [],
      tools: [],
      expectedTool: "weaver-refactor",
      maxSteps: 3,
      step,
      cannedResultFor: () => "result",
    });

    expect(result.matched).toBe(true);
    expect(result.matchedAtStep).toBe(1);
  });

  it("reports no match and stops at the budget when the skill is never reached", async () => {
    // Always returns a non-expected call, so the loop must exhaust the budget.
    let calls = 0;
    const step: ModelStep = async () => {
      calls += 1;
      return resp("Grep");
    };

    const result = await runAgenticLoop({
      messages: [],
      tools: [],
      expectedTool: "weaver-refactor",
      maxSteps: 3,
      step,
      cannedResultFor: () => "result",
    });

    expect(result.matched).toBe(false);
    expect(result.matchedAtStep).toBeUndefined();
    expect(result.steps).toBe(3);
    expect(calls).toBe(3); // never calls the model past the budget
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
      expectedTool: "weaver-refactor",
      maxSteps: 3,
      step,
      cannedResultFor: () => "result",
    });

    expect(result.matched).toBe(false);
    expect(result.steps).toBe(2);
    expect(callCount()).toBe(2); // did not take a third turn despite budget remaining
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
      expectedTool: "weaver-refactor",
      maxSteps: 3,
      step,
      cannedResultFor: (call) => `CANNED(${call.name})`,
    });

    const secondTurn = histories[1];
    const assistantEcho = secondTurn.find(
      (m) => m.role === "assistant" && typeof m.content === "string" && m.content.includes("Grep"),
    );
    const cannedTurn = secondTurn.find(
      (m) =>
        m.role === "user" && typeof m.content === "string" && m.content.includes("CANNED(Grep)"),
    );
    expect(assistantEcho, "the prior call must be echoed as an assistant text turn").toBeDefined();
    expect(cannedTurn, "second turn must carry the canned result as a user message").toBeDefined();
    expect(secondTurn.every((m) => m.tool_calls === undefined)).toBe(true);
  });
});

describe("cannedToolResult", () => {
  const laneToolNames = [
    ...SKILL_NAMES,
    ...COMPETING_TOOLS.map((t) => t.function.name),
    BASH_TOOL.function.name,
  ];

  it.each(laneToolNames)("returns a non-empty canned result for %s", (name) => {
    expect(cannedToolResult(tc(name))).toBeTruthy();
  });

  it("throws for an unknown tool name", () => {
    expect(() => cannedToolResult(tc("unknownTool"))).toThrow(/unknownTool/);
  });
});
