import { afterEach, describe, expect, it, vi } from "vitest";
import { type ModelStep, runAgenticLoop } from "./agentic-loop.js";
import type { ModelResponse, ToolCall } from "./call-model.js";

const tc = (name: string): ToolCall => ({ name, arguments: {} });
const bashCall = (command: string): ToolCall => ({ name: "bash", arguments: { command } });
const resp = (...names: string[]): ModelResponse => ({ toolCalls: names.map(tc), text: "" });

/** A model that returns the given responses in order. */
function scriptedModel(responses: ModelResponse[]): { step: ModelStep } {
  let calls = 0;
  const step: ModelStep = async () => {
    const response = responses[calls];
    calls += 1;
    return response;
  };
  return { step };
}

describe("runAgenticLoop debug tracing", () => {
  afterEach(() => {
    delete process.env.WEAVER_EVAL_DEBUG;
  });

  it("logs the initial prompt, each step, and the echoed result when WEAVER_EVAL_DEBUG=1", async () => {
    process.env.WEAVER_EVAL_DEBUG = "1";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { step } = scriptedModel([resp("Grep"), resp("weaver-refactor")]);

    await runAgenticLoop({
      messages: [
        { role: "user", content: "do the thing" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "seed-1", name: "bash", arguments: { command: "ls" } }],
        },
      ],
      tools: [],
      matches: (call) => call.name === "weaver-refactor",
      isSkillMdRead: () => false,
      maxSteps: 3,
      step,
      cannedResultFor: () => "canned result",
    });

    const output = spy.mock.calls.map((call) => String(call[0])).join("\n");
    spy.mockRestore();

    expect(output).toContain("initial prompt");
    expect(output).toContain("[user]");
    expect(output).toContain("do the thing");
    expect(output).toContain("[assistant]");
    expect(output).toContain('→ bash({"command":"ls"})');
    expect(output).toContain("step 1");
    expect(output).toContain("step 2");
    expect(output).toContain("→ Grep({})");
    expect(output).toContain("← Grep result:");
    expect(output).toContain("canned result");
    expect(output).not.toContain("more chars");
    // The matching step returns immediately without echoing its own result.
    expect(output).not.toContain("← weaver-refactor result:");
  });

  it("does not log anything when WEAVER_EVAL_DEBUG is unset, even across an echoed turn", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { step } = scriptedModel([resp("Grep"), resp("weaver-refactor")]);

    await runAgenticLoop({
      messages: [{ role: "user", content: "task" }],
      tools: [],
      matches: (call) => call.name === "weaver-refactor",
      isSkillMdRead: () => false,
      maxSteps: 3,
      step,
      cannedResultFor: () => "result",
    });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("logs a bash call's command verbatim rather than JSON-stringifying its arguments", async () => {
    process.env.WEAVER_EVAL_DEBUG = "1";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { step } = scriptedModel([
      { toolCalls: [bashCall("grep -rn userId src/")], text: "" },
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

    const output = spy.mock.calls.map((call) => String(call[0])).join("\n");
    spy.mockRestore();

    expect(output).toContain("→ bash(grep -rn userId src/)");
    expect(output).not.toContain('bash({"command"');
  });

  it("truncates a debug-logged result over 800 characters with a remaining-chars suffix", async () => {
    process.env.WEAVER_EVAL_DEBUG = "1";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const longResult = "x".repeat(850);
    const { step } = scriptedModel([resp("Grep"), resp("weaver-refactor")]);

    await runAgenticLoop({
      messages: [],
      tools: [],
      matches: (call) => call.name === "weaver-refactor",
      isSkillMdRead: () => false,
      maxSteps: 3,
      step,
      cannedResultFor: () => longResult,
    });

    const output = spy.mock.calls.map((call) => String(call[0])).join("\n");
    spy.mockRestore();

    expect(output).toContain(`${"x".repeat(800)}… (50 more chars)`);
    expect(output).not.toContain("x".repeat(801));
  });

  it("does not truncate a debug-logged result of exactly 800 characters", async () => {
    process.env.WEAVER_EVAL_DEBUG = "1";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exactResult = "y".repeat(800);
    const { step } = scriptedModel([resp("Grep"), resp("weaver-refactor")]);

    await runAgenticLoop({
      messages: [],
      tools: [],
      matches: (call) => call.name === "weaver-refactor",
      isSkillMdRead: () => false,
      maxSteps: 3,
      step,
      cannedResultFor: () => exactResult,
    });

    const output = spy.mock.calls.map((call) => String(call[0])).join("\n");
    spy.mockRestore();

    expect(output).toContain(exactResult);
    expect(output).not.toContain("more chars");
  });
});
