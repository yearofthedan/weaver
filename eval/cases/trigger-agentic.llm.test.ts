import { describe, expect, it } from "vitest";
import { cannedToolResult, runAgenticLoop } from "../harness/agentic-loop.js";
import { type ChatMessage, callModel } from "../harness/call-model.js";
import { buildClutterSystemPrompt } from "../harness/clutter.js";
import { buildHabitMomentumSeed } from "../harness/seed.js";
import { BASH_TOOL, COMPETING_TOOLS, skillTools } from "../harness/tools.js";
import { CASES } from "./cases.js";

// Room for one precursor step (e.g. find-references) plus the target operation,
// without rewarding aimless wandering.
const MAX_STEPS = 3;

// Same skill-trigger subset as the adversarial lane; boundary/bash cases stay
// single-shot there. The two lanes share this subset so the gap between them is
// interpretable: red in adversarial but green here means a precursor case.
const skillTriggerCases = CASES.filter((c) => c.stage === "trigger" && c.expect.tool !== "bash");

const tools = [...skillTools(), BASH_TOOL, ...COMPETING_TOOLS];

describe("agentic trigger lane", () => {
  it.each(
    skillTriggerCases,
  )("$name — skill is reached within the step budget under pressure", async (c) => {
    const expectedTool = c.expect.tool;
    expect(expectedTool, "trigger case must declare expect.tool").toBeDefined();
    if (!expectedTool) return;

    const messages: ChatMessage[] = [
      { role: "system", content: buildClutterSystemPrompt() },
      ...buildHabitMomentumSeed(c.task),
    ];

    const result = await runAgenticLoop({
      messages,
      tools,
      expectedTool,
      maxSteps: MAX_STEPS,
      step: callModel,
      cannedResultFor: cannedToolResult,
    });

    const trail = result.trail.map((t) => t.name).join(" → ") || "(no tool calls)";
    expect(
      result.matched,
      `Expected "${expectedTool}" within ${MAX_STEPS} steps for task: "${c.task}". ` +
        `Model converged on: ${trail}`,
    ).toBe(true);
  });
});
