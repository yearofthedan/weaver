import { describe, expect, it } from "vitest";
import { callModel } from "../harness/call-model.js";
import { BASH_TOOL, skillTools } from "../harness/tools.js";
import { CASES } from "./cases.js";

const triggerCases = CASES.filter((c) => c.stage === "trigger");

const tools = [...skillTools(), BASH_TOOL];

describe("trigger-stage cases", () => {
  it.each(triggerCases)("$name — model selects the correct skill tool", async (c) => {
    expect(c.expect.skill, "trigger case must declare expect.skill").toBeDefined();

    const response = await callModel([{ role: "user", content: c.task }], tools);

    const firstCall = response.toolCalls[0];

    expect(
      firstCall,
      `No tool call emitted for task: "${c.task}". Model responded with text: ${response.text}`,
    ).toBeDefined();

    expect(
      firstCall.name,
      firstCall?.name === "bash"
        ? `Model called bash directly instead of a skill: ${JSON.stringify(firstCall.arguments)}`
        : `Expected skill "${c.expect.skill}", got tool "${firstCall?.name}"`,
    ).toBe(c.expect.skill);
  });
});
