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
import { rateLaneTools, SKILL_TOOL } from "../harness/tools.js";
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

const tools = [SKILL_TOOL, ...rateLaneTools()];
const systemContent = `${buildClutterSystemPrompt()}\n\n${buildAvailableSkillsPrompt()}`;

/**
 * Renders a tool call with its raw arguments. For bash the command string is
 * the evidence the lane exists to capture — a name-only trail cannot
 * distinguish "never ran weaver" from a matcher false-negative.
 */
function formatCall(call: ToolCall): string {
  const args =
    call.name === "bash" ? String(call.arguments.command ?? "") : JSON.stringify(call.arguments);
  return `${call.name}(${args})`;
}

/** Returns the skill name if this call is a Read of a skill's SKILL.md, else undefined. */
function skillNameFromRead(call: ToolCall): string | undefined {
  if (call.name !== "Read") return undefined;
  const filePath = String(call.arguments.file ?? call.arguments.file_path ?? "");
  // suffix, not exact: tolerate an absolute or ./-prefixed read path
  return SKILL_NAMES.find((name) => filePath.endsWith(skillLocation(name)));
}

/**
 * Returns the skill name when this call loads a skill the way a host allows:
 * a `Skill(skill: <name>)` invocation, or a Read of the skill's SKILL.md.
 * A direct call named after a skill is NOT a load — no host declares such a
 * tool; it gets an unknown-tool error like any other hallucination.
 */
function skillNameFromLoad(call: ToolCall): string | undefined {
  if (call.name === "Skill") {
    const requested = String(call.arguments.skill ?? "");
    return SKILL_NAMES.find((name) => name === requested);
  }
  return skillNameFromRead(call);
}

describe("agentic rate lane", () => {
  it.each(
    skillTriggerCases,
  )("$name — weaver is invoked within the step budget across trials", async (c) => {
    const expectedCommand = c.expect.command;
    expect(expectedCommand, "trigger case must declare expect.command").toBeDefined();
    if (!expectedCommand) return;

    interface TrialRecord {
      matched: boolean;
      trail: ToolCall[];
      skillMdRead: boolean;
      readTurn?: number;
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
        // Pass = the model actually runs the CLI: a bash `weaver <command>` call.
        matches: (call) =>
          call.name === "bash" &&
          extractBashCommands([call]).some((cmd) => isWeaverInvocation(cmd, expectedCommand)),
        isSkillMdRead: (call) => skillNameFromLoad(call) !== undefined,
        maxSteps: MAX_STEPS,
        step: callModel,
        cannedResultFor: (call) => {
          const skillName = skillNameFromLoad(call);
          if (skillName !== undefined) {
            return readSkillFile(skillName);
          }
          if (call.name === "Skill") {
            return `Error: unknown skill "${String(call.arguments.skill ?? "")}".`;
          }
          if (SKILL_NAMES.some((name) => name === call.name)) {
            // Hallucinated direct skill-name call — respond as a host would.
            return `Error: no such tool "${call.name}". Available tools: Skill, bash, Grep, Glob, Read.`;
          }
          return cannedToolResult(call);
        },
      });

      trialRecords.push({
        matched: result.matched,
        trail: result.trail,
        skillMdRead: result.skillMdRead,
        readTurn: result.readTurn,
      });
    }

    const rate = computeRate(trialRecords.map((r) => r.matched));

    const trailSummary = trialRecords
      .map(
        (r, i) =>
          `  trial ${i + 1} [${r.matched ? "matched" : "no match"}, ${r.skillMdRead ? `skill loaded@${r.readTurn}` : "no skill load"}]: ${r.trail.map(formatCall).join(" → ") || "(no tool calls)"}`,
      )
      .join("\n");

    // Printed for passing cases too: the rate alone hides how the model got
    // there — the trail shows precursor steps and any loaded-but-didn't-convert
    // trials (right skill loaded, CLI never run) a bare pass/fail would mask.
    console.log(`${c.name} — rate ${rate.passed}/${rate.total}\n${trailSummary}`);

    expect(
      rate.belowAlarm,
      `"${c.name}" trigger rate ${rate.passed}/${rate.total} is below the 2/3 floor for command "${expectedCommand}". Trails:\n${trailSummary}`,
    ).toBe(false);
  });
});
