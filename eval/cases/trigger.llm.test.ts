import { describe, expect, it } from "vitest";
import { callModel } from "../harness/call-model.js";
import { BASH_TOOL, skillTools } from "../harness/tools.js";
import { CASES } from "./cases.js";

const triggerCases = CASES.filter((c) => c.stage === "trigger");

const tools = [...skillTools(), BASH_TOOL];

describe("trigger-stage cases", () => {
  it.each(triggerCases)("$name — model selects the correct tool", async (c) => {
    const expectedTool = c.expect.tool;
    expect(expectedTool, "trigger case must declare expect.tool").toBeDefined();

    const response = await callModel([{ role: "user", content: c.task }], tools);

    const firstCall = response.toolCalls[0];

    expect(
      firstCall,
      `No tool call emitted for task: "${c.task}". Model responded with text: ${response.text}`,
    ).toBeDefined();

    expect(
      firstCall.name,
      `Expected "${expectedTool}", got "${firstCall?.name}" (args: ${JSON.stringify(firstCall?.arguments)})`,
    ).toBe(expectedTool);
  });
});
