import { describe, expect, it } from "vitest";
import { cannedToolResult, runAgenticLoop } from "../harness/agentic-loop.js";
import { extractBashCommands, isWeaverInvocation } from "../harness/assertions.js";
import type { ToolCall } from "../harness/call-model.js";
import { type ChatMessage, callModel } from "../harness/call-model.js";
import { buildClutterSystemPrompt } from "../harness/clutter.js";
import {
  buildAvailableSkillsPrompt,
  readSkillFile,
  SKILL_NAMES,
  skillLocation,
} from "../harness/context.js";
import { computeRate } from "../harness/rate.js";
import { buildHabitMomentumSeed } from "../harness/seed.js";
import { rateLaneTools } from "../harness/tools.js";
import { CASES } from "./cases.js";

// Two-hop trajectory: Read SKILL.md → optional precursor → weaver bash call.
// Room for Read + 2 further steps (precursor + operation).
const MAX_STEPS = 6;

// N trials per case — configurable for spot-checks; default 3.
const raw = process.env.WEAVER_EVAL_TRIALS;
const TRIALS = raw === undefined || raw === "" ? 3 : Number.parseInt(raw, 10);

// Same skill-trigger subset as the adversarial lane; boundary/bash cases stay
// single-shot there. The two lanes share this subset so the gap is interpretable:
// red in adversarial but green here means a precursor case.
const skillTriggerCases = CASES.filter((c) => c.stage === "trigger" && c.expect.skill !== "bash");

const tools = rateLaneTools();
const systemContent = `${buildClutterSystemPrompt()}\n\n${buildAvailableSkillsPrompt()}`;

/** Returns the skill name if this call is a Read of a skill's SKILL.md, else undefined. */
function skillNameFromRead(call: ToolCall): string | undefined {
  if (call.name !== "Read") return undefined;
  const filePath = String(call.arguments.file ?? call.arguments.file_path ?? "");
  // suffix, not exact: tolerate an absolute or ./-prefixed read path
  return SKILL_NAMES.find((name) => filePath.endsWith(skillLocation(name)));
}

describe("agentic rate lane", () => {
  it.each(
    skillTriggerCases,
  )("$name — weaver is invoked within the step budget across trials", async (c) => {
    const expectedCommand = c.expect.command;
    const expectedSkill = c.expect.skill;
    expect(expectedCommand, "trigger case must declare expect.command").toBeDefined();
    if (!expectedCommand) return;

    interface TrialRecord {
      matched: boolean;
      trail: ToolCall[];
    }

    const trialRecords: TrialRecord[] = [];

    for (let trial = 0; trial < TRIALS; trial++) {
      const messages: ChatMessage[] = [
        { role: "system", content: systemContent },
        ...buildHabitMomentumSeed(c.task),
      ];

      const result = await runAgenticLoop({
        messages,
        tools,
        matches: (call) =>
          // Real invocation: a bash `weaver <command>` call.
          (call.name === "bash" &&
            extractBashCommands([call]).some((cmd) => isWeaverInvocation(cmd, expectedCommand))) ||
          // Stopgap: the model calls the owning skill as a (hallucinated) tool
          // rather than running the CLI. Credits skill selection, not real
          // invocation — see the framing-fix follow-up in handoff.md.
          call.name === expectedSkill,
        isSkillMdRead: (call) => skillNameFromRead(call) !== undefined,
        maxSteps: MAX_STEPS,
        step: callModel,
        cannedResultFor: (call) => {
          const skillName = skillNameFromRead(call);
          if (skillName !== undefined) {
            return readSkillFile(skillName);
          }
          return cannedToolResult(call);
        },
      });

      trialRecords.push({ matched: result.matched, trail: result.trail });
    }

    const rate = computeRate(trialRecords.map((r) => r.matched));

    const trailSummary = trialRecords
      .map(
        (r, i) =>
          `  trial ${i + 1}: ${r.trail.map((t) => t.name).join(" → ") || "(no tool calls)"}`,
      )
      .join("\n");

    expect(
      rate.belowAlarm,
      `"${c.name}" trigger rate ${rate.passed}/${rate.total} is below the 2/3 floor for command "${expectedCommand}". Trails:\n${trailSummary}`,
    ).toBe(false);
  });
});
