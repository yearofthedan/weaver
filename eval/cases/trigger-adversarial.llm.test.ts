import { describe, expect, it } from "vitest";
import { type ChatMessage, callModel } from "../harness/call-model.js";
import { buildClutterSystemPrompt } from "../harness/clutter.js";
import { buildHabitMomentumSeed } from "../harness/seed.js";
import { BASH_TOOL, COMPETING_TOOLS, skillTools } from "../harness/tools.js";
import { CASES } from "./cases.js";

// Boundary (bash) cases are excluded on purpose — they guard over-triggering,
// which competition makes less likely, so they stay in the clean lane.
const skillTriggerCases = CASES.filter((c) => c.stage === "trigger" && c.expect.skill !== "bash");

const tools = [...skillTools(), BASH_TOOL, ...COMPETING_TOOLS];

describe("adversarial trigger lane", () => {
  it.each(skillTriggerCases)("$name — skill still wins under pressure", async (c) => {
    const expectedTool = c.expect.skill;
    expect(expectedTool, "trigger case must declare expect.tool").toBeDefined();

    const messages: ChatMessage[] = [
      { role: "system", content: buildClutterSystemPrompt() },
      ...buildHabitMomentumSeed(c.task),
    ];

    const response = await callModel(messages, tools);
    const firstCall = response.toolCalls[0];

    expect(
      firstCall,
      `No tool call emitted under pressure for task: "${c.task}". Model responded with text: ${response.text}`,
    ).toBeDefined();

    expect(
      firstCall.name,
      `Under pressure, expected "${expectedTool}" but "${firstCall?.name}" won (args: ${JSON.stringify(firstCall?.arguments)})`,
    ).toBe(expectedTool);
  });
});
