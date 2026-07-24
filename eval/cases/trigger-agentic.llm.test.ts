import { describe, expect, it } from "vitest";
import {
  boundaryTrialClean,
  resolveCannedResult,
  runAgenticLoop,
} from "../harness/agentic-loop.js";
import {
  extractBashCommands,
  isWeaverInvocation,
  matchWeaverCommand,
} from "../harness/assertions.js";
import type { ToolCall } from "../harness/call-model.js";
import { type ChatMessage, callModel } from "../harness/call-model.js";
import { seedForCase } from "../harness/case-lane.js";
import { buildClutterSystemPrompt } from "../harness/clutter.js";
import {
  buildAvailableSkillsPrompt,
  classifySkillReach,
  readSkillFile,
} from "../harness/context.js";
import { isMutatingCompetitor } from "../harness/grade.js";
import { classifyTrialOutcome, computeOutcomes } from "../harness/outcome.js";
import { computeRate } from "../harness/rate.js";
import { rateLaneTools, SKILL_TOOL } from "../harness/tools.js";
import { CASES } from "./cases.js";

// Two-hop trajectory: Read SKILL.md → optional precursor → weaver bash call.
// Room for Read + 2 further steps (precursor + operation).
const MAX_STEPS = 6;

// N trials per case — configurable for spot-checks; default 3.
const raw = process.env.WEAVER_EVAL_TRIALS;
const TRIALS = raw === undefined || raw === "" ? 3 : Number.parseInt(raw, 10);

// Generous per-call ceiling, not a measured latency — a backstop against a
// wedged run, sized so ordinary slowness never trips it.
const PER_CALL_BUDGET_MS = 30_000;

// Trials run sequentially and each burns up to MAX_STEPS model calls, so this
// lane's wall time scales with WEAVER_EVAL_TRIALS while the other lanes stay
// single-shot. Scaling here rather than in vitest.llm.config.ts keeps the
// config's short timeout as a fast-fail floor for those lanes, and avoids
// duplicating both the env parsing above and MAX_STEPS into the config.
const LANE_TIMEOUT_MS = TRIALS * MAX_STEPS * PER_CALL_BUDGET_MS;

// Same skill-trigger subset as the adversarial lane; the two lanes share it so
// the gap is interpretable: red in adversarial but green here means a
// precursor case.
const skillTriggerCases = CASES.filter((c) => c.stage === "trigger" && c.expect.skill !== "bash");

// Legitimate shell work a description must not steal. Distinct from
// skillTriggerCases: there is no expected weaver command to converge on —
// the pass condition is that the model never converges on one.
const boundaryCases = CASES.filter((c) => c.stage === "trigger" && c.expect.skill === "bash");

const tools = [SKILL_TOOL, ...rateLaneTools()];
// The names the lane actually declares. A call to anything else is a
// hallucinated tool — resolveCannedResult turns it into a host error rather
// than crashing on a missing canned result.
const declaredToolNames = tools.map((t) => t.function.name);
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

/**
 * Feeds a skill's real SKILL.md body back for any reach `classifySkillReach`
 * recognizes — a sanctioned load or a tool-style call — and a host-style
 * unknown-skill error for a bad `Skill()` name; anything else is resolved by
 * `resolveCannedResult` against the lane's declared tools (a hallucinated tool
 * name gets a host "no such tool" error, a declared tool its canned result).
 * Shared by both `it.each` blocks below — they run the same tool set and only
 * differ in `matches`.
 */
function cannedResultForCall(call: ToolCall, caseResults?: Record<string, string>): string {
  const reach = classifySkillReach(call);
  if (reach !== undefined) {
    return readSkillFile(reach.skill);
  }
  if (call.name === "Skill") {
    return `Error: unknown skill "${String(call.arguments.skill ?? "")}".`;
  }
  return resolveCannedResult(call, declaredToolNames, caseResults);
}

describe("agentic rate lane", () => {
  it.each(skillTriggerCases)(
    "$name — weaver is invoked within the step budget across trials",
    async (c) => {
      const expectedCommand = c.expect.command;
      expect(expectedCommand, "trigger case must declare expect.command").toBeDefined();
      if (!expectedCommand) return;

      interface TrialRecord {
        matched: boolean;
        matchedAtStep?: number;
        failedAtStep?: number;
        trail: ToolCall[];
        skillMdRead: boolean;
        skillCalledAsTool: boolean;
        readTurn?: number;
        abandonedText?: string;
      }

      const trialRecords: TrialRecord[] = [];

      for (let trial = 0; trial < TRIALS; trial++) {
        const messages: ChatMessage[] = [
          { role: "system", content: systemContent },
          ...seedForCase(c),
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
          isSkillMdRead: (call) => classifySkillReach(call)?.via === "load",
          isSkillCalledAsTool: (call) => classifySkillReach(call)?.via === "tool",
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
          skillCalledAsTool: result.skillCalledAsTool,
          readTurn: result.readTurn,
          abandonedText: result.abandonedText,
        });
      }

      const rate = computeRate(trialRecords.map((r) => r.matched));

      // Reporting only, alongside the gating rate above: names which tier each
      // trial landed in — clean content signal, host-exposure noise on an
      // otherwise-right answer, a body that didn't guide, or a skill never
      // reached at all.
      const trialOutcomes = trialRecords.map((r) =>
        classifyTrialOutcome({
          matched: r.matched,
          skillMdRead: r.skillMdRead,
          skillCalledAsTool: r.skillCalledAsTool,
        }),
      );
      const outcomeTally = computeOutcomes(trialOutcomes);

      // matchedAtStep distinguishes a first-call win (1 — no precursor needed)
      // from a precursor-then-win (matched later); failedAtStep marks a trial
      // that hard-failed on a mutating competitor rather than merely running
      // out of budget; both are absent when the trial never matched or failed.
      const trailSummary = trialRecords
        .map((r, i) => {
          let outcome: string;
          if (r.matched) {
            const segment = extractBashCommands(r.trail).find((cmd) =>
              isWeaverInvocation(cmd, expectedCommand),
            );
            const argsVerdict = segment
              ? matchWeaverCommand(segment, expectedCommand, c.expect.keyArgs).outcome
              : undefined;
            outcome = `matched@${r.matchedAtStep}${argsVerdict !== undefined ? ` args:${argsVerdict}` : ""}`;
          } else {
            outcome = r.failedAtStep !== undefined ? `competitor@${r.failedAtStep}` : "no match";
          }
          return `  trial ${i + 1} [${outcome}, ${r.skillMdRead ? `skill loaded@${r.readTurn}` : "no skill load"}, ${trialOutcomes[i]}]: ${r.trail.map(formatCall).join(" → ") || "(no tool calls)"}${r.abandonedText !== undefined ? `\n    abandoned with text: ${JSON.stringify(r.abandonedText.slice(0, 500))}` : ""}`;
        })
        .join("\n");

      // Printed for passing cases too: the rate alone hides how the model got
      // there — the trail shows precursor steps and any loaded-but-didn't-convert
      // trials (right skill loaded, CLI never run) a bare pass/fail would mask.
      // The composition names each tier's count so a red or a warned pass can
      // be attributed to weaver's content vs. the host's skill-exposure style.
      console.log(
        `${c.name} — rate ${rate.passed}/${rate.total} (clean-pass ${outcomeTally.cleanPass}, warned-pass ${outcomeTally.warnedPass}, content-fail ${outcomeTally.contentFail}, never-reached ${outcomeTally.neverReached})\n${trailSummary}`,
      );

      expect(
        rate.belowAlarm,
        `"${c.name}" trigger rate ${rate.passed}/${rate.total} is below the 2/3 floor for command "${expectedCommand}". Trails:\n${trailSummary}`,
      ).toBe(false);
    },
    LANE_TIMEOUT_MS,
  );
});

describe("agentic rate lane — boundary", () => {
  it.each(boundaryCases)(
    "$name — the model stays in bash across trials",
    async (c) => {
      interface TrialRecord {
        clean: boolean;
        trail: ToolCall[];
        skillMdRead: boolean;
      }

      const trialRecords: TrialRecord[] = [];

      for (let trial = 0; trial < TRIALS; trial++) {
        const messages: ChatMessage[] = [
          { role: "system", content: systemContent },
          ...seedForCase(c),
        ];

        // Never satisfied: a boundary trial has no target command to converge
        // on, so the loop runs to the step budget (or the model abandons with
        // text after its bash result) and boundaryTrialClean judges the trail.
        const result = await runAgenticLoop({
          messages,
          tools,
          matches: () => false,
          isSkillMdRead: (call) => classifySkillReach(call)?.via === "load",
          isSkillCalledAsTool: (call) => classifySkillReach(call)?.via === "tool",
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
    },
    LANE_TIMEOUT_MS,
  );
});
