import { describe, expect, it } from "vitest";
import { callModel } from "../harness/call-model.js";
import { triggerContext } from "../harness/context.js";
import { BASH_TOOL, SKILL_TOOL } from "../harness/tools.js";
import { CASES } from "./cases.js";

const triggerCases = CASES.filter((c) => c.stage === "trigger");

const systemPrompt = triggerContext();
const tools = [SKILL_TOOL, BASH_TOOL];

describe("trigger-stage cases", () => {
  it.each(triggerCases)("$name — model invokes skill tool with correct skill name", async (c) => {
    expect(c.expect.skill, "trigger case must declare expect.skill").toBeDefined();

    const response = await callModel(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: c.task },
      ],
      tools,
    );

    const firstCall = response.toolCalls[0];

    expect(
      firstCall,
      `No tool call emitted for task: "${c.task}". Model responded with text: ${response.text}`,
    ).toBeDefined();

    expect(
      firstCall.name,
      `Expected first tool call to be "skill", got "${firstCall?.name}". ` +
        `Model called bash directly instead of selecting a skill.`,
    ).toBe("skill");

    expect(
      firstCall.arguments.name,
      `Expected skill name "${c.expect.skill}", got "${firstCall?.arguments.name}"`,
    ).toBe(c.expect.skill);
  });
});
