import { describe, expect, it } from "vitest";
import { boundaryTrialClean, cannedToolResult, runAgenticLoop } from "../harness/agentic-loop.js";
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
import { isMutatingCompetitor } from "../harness/grade.js";
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

// Same skill-trigger subset as the adversarial lane; the two lanes share it so
// the gap is interpretable: red in adversarial but green here means a
// precursor case.
const skillTriggerCases = CASES.filter((c) => c.stage === "trigger" && c.expect.skill !== "bash");

// Legitimate shell work a description must not steal. Distinct from
// skillTriggerCases: there is no expected weaver command to converge on —
// the pass condition is that the model never converges on one.
const boundaryCases = CASES.filter((c) => c.stage === "trigger" && c.expect.skill === "bash");

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

/**
 * Feeds a skill's real SKILL.md body back for a load, a host-style
 * unknown-tool error for a hallucinated call, and the case's canned result
 * otherwise (case override first, then the harness's global defaults — see
 * `cannedToolResult`). Shared by both `it.each` blocks below — they run the
 * same tool set and only differ in `matches`.
 */
function cannedResultForCall(call: ToolCall, caseResults?: Record<string, string>): string {
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
  return cannedToolResult(call, caseResults);
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
      matchedAtStep?: number;
      failedAtStep?: number;
      trail: ToolCall[];
      skillMdRead: boolean;
      readTurn?: number;
      abandonedText?: string;
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
        // Fail = the model reaches for a different destructive weaver op
        // instead — a wrong-op detour, not a recoverable precursor.
        hardFails: (call) => isMutatingCompetitor(call, expectedCommand),
        isSkillMdRead: (call) => skillNameFromLoad(call) !== undefined,
        maxSteps: MAX_STEPS,
        step: callModel,
        cannedResultFor: (call) => cannedResultForCall(call, c.cannedResults),
      });

      trialRecords.push({
        matched: result.matched,
        matchedAtStep: result.matchedAtStep,
        failedAtStep: result.failedAtStep,
        trail: result.trail,
        skillMdRead: result.skillMdRead,
        readTurn: result.readTurn,
        abandonedText: result.abandonedText,
      });
    }

    const rate = computeRate(trialRecords.map((r) => r.matched));

    // matchedAtStep distinguishes a first-call win (1 — no precursor needed)
    // from a precursor-then-win (matched later); failedAtStep marks a trial
    // that hard-failed on a mutating competitor rather than merely running
    // out of budget; both are absent when the trial never matched or failed.
    const trailSummary = trialRecords
      .map((r, i) => {
        const outcome = r.matched
          ? `matched@${r.matchedAtStep}`
          : r.failedAtStep !== undefined
            ? `competitor@${r.failedAtStep}`
            : "no match";
        return `  trial ${i + 1} [${outcome}, ${r.skillMdRead ? `skill loaded@${r.readTurn}` : "no skill load"}]: ${r.trail.map(formatCall).join(" → ") || "(no tool calls)"}${r.abandonedText !== undefined ? `\n    abandoned with text: ${JSON.stringify(r.abandonedText.slice(0, 500))}` : ""}`;
      })
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

describe("agentic rate lane — boundary", () => {
  it.each(boundaryCases)("$name — the model stays in bash across trials", async (c) => {
    interface TrialRecord {
      clean: boolean;
      trail: ToolCall[];
      skillMdRead: boolean;
    }

    const trialRecords: TrialRecord[] = [];

    for (let trial = 0; trial < TRIALS; trial++) {
      const messages: ChatMessage[] = [
        { role: "system", content: systemContent },
        ...buildHabitMomentumSeed(c.task),
      ];

      // Never satisfied: a boundary trial has no target command to converge
      // on, so the loop runs to the step budget (or the model abandons with
      // text after its bash result) and boundaryTrialClean judges the trail.
      const result = await runAgenticLoop({
        messages,
        tools,
        matches: () => false,
        isSkillMdRead: (call) => skillNameFromLoad(call) !== undefined,
        maxSteps: MAX_STEPS,
        step: callModel,
        cannedResultFor: (call) => cannedResultForCall(call, c.cannedResults),
      });

      trialRecords.push({
        clean: boundaryTrialClean(result),
        trail: result.trail,
        skillMdRead: result.skillMdRead,
      });
    }

    const trailSummary = trialRecords
      .map(
        (r, i) =>
          `  trial ${i + 1} [${r.clean ? "clean" : "OVER-TRIGGERED"}${r.skillMdRead ? ", skill loaded" : ""}]: ${r.trail.map(formatCall).join(" → ") || "(no tool calls)"}`,
      )
      .join("\n");

    const cleanCount = trialRecords.filter((r) => r.clean).length;
    console.log(`${c.name} — ${cleanCount}/${trialRecords.length} clean\n${trailSummary}`);

    expect(
      trialRecords.every((r) => r.clean),
      `"${c.name}" over-triggered in at least one trial — a boundary case must stay clean (no skill load, no weaver call) across all trials. Trails:\n${trailSummary}`,
    ).toBe(true);
  });
});
