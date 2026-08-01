import { describe, expect, it } from "vitest";
import { type AgenticResult, boundaryTrialClean } from "../harness/agentic-loop.js";
import {
  extractBashCommands,
  matchWeaverCommand,
  weaverSubcommand,
} from "../harness/assertions.js";
import { callModel, type ToolCall } from "../harness/call-model.js";
import { FRONT_LOADED_MAX_STEPS, PROGRESSIVE_MAX_STEPS } from "../harness/case-lane.js";
import { formatRunHeader } from "../harness/config.js";
import { classifyTrialOutcome, computeOutcomes } from "../harness/outcome.js";
import { type CaseRun, runCaseTrials, runTrial } from "../harness/run-case.js";
import { BASE_TRIALS, caseAlarms, ESCALATED_TRIALS, isAtCeiling } from "../harness/verdict.js";
import {
  CASES,
  isBoundaryCase,
  isFrontLoadedCase,
  isProgressiveOpCase,
  type OpCase,
} from "./cases.js";

// Base trial count per case — configurable for spot-checks; default BASE_TRIALS.
// A case that falls below the 2/3 floor at this count escalates to ESCALATED_TRIALS.
const raw = process.env.WEAVER_EVAL_TRIALS;
const BASE_TRIAL_COUNT = raw === undefined || raw === "" ? BASE_TRIALS : Number.parseInt(raw, 10);

console.log(formatRunHeader(BASE_TRIAL_COUNT));

// Generous per-call ceiling, not a measured latency — a backstop against a
// wedged run, sized so ordinary slowness never trips it.
const PER_CALL_BUDGET_MS = 30_000;

// Trials run sequentially and each burns up to the exposure's step budget, so
// the worst case is an escalated case (or a WEAVER_EVAL_TRIALS override larger
// than the escalated total) at that exposure's step budget. Recomputed per
// exposure — front-loaded's 3-step budget shouldn't inherit progressive's
// 6-step timeout, or a stalled front-loaded provider reads as slow rather than
// a clear regression signal.
const worstCaseTrials = Math.max(ESCALATED_TRIALS, BASE_TRIAL_COUNT);
const PROGRESSIVE_TIMEOUT_MS = worstCaseTrials * PROGRESSIVE_MAX_STEPS * PER_CALL_BUDGET_MS;
const FRONT_LOADED_TIMEOUT_MS = worstCaseTrials * FRONT_LOADED_MAX_STEPS * PER_CALL_BUDGET_MS;
// Boundary cases never escalate — a fixed BASE_TRIAL_COUNT run at progressive's step budget.
const BOUNDARY_TIMEOUT_MS = BASE_TRIAL_COUNT * PROGRESSIVE_MAX_STEPS * PER_CALL_BUDGET_MS;

const progressiveOpCases = CASES.filter(isProgressiveOpCase);
const frontLoadedCases = CASES.filter(isFrontLoadedCase);
const boundaryCases = CASES.filter(isBoundaryCase);

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
 * One trial's line in a case's trail summary: its outcome (matched step,
 * hard-fail step, a same-subcommand attempt with the wrong args, or no
 * attempt at all), the model's `finish_reason`, and every tool call it made.
 */
function formatTrial(
  trial: AgenticResult,
  index: number,
  expectedCommand: string,
  keyArgs?: Record<string, unknown>,
): string {
  let outcome: string;
  if (trial.matched) {
    outcome = `matched@${trial.matchedAtStep}`;
  } else if (trial.failedAtStep !== undefined) {
    outcome = `competitor@${trial.failedAtStep}`;
  } else {
    const attempt = extractBashCommands(trial.trail).find(
      (cmd) => weaverSubcommand(cmd) === expectedCommand,
    );
    const argsOutcome = attempt
      ? matchWeaverCommand(attempt, expectedCommand, keyArgs).outcome
      : undefined;
    outcome = argsOutcome !== undefined ? `reached, args:${argsOutcome}` : "no attempt";
  }

  const trail = trial.trail.map(formatCall).join(" → ") || "(no tool calls)";
  const abandoned =
    trial.abandonedText !== undefined
      ? `\n    abandoned with text: ${JSON.stringify(trial.abandonedText.slice(0, 500))}`
      : "";
  return `  trial ${index + 1} [${outcome}, finish:${trial.finishReason ?? "n/a"}]: ${trail}${abandoned}`;
}

/**
 * Reports and gates an op case's run: prints the rate (every case, including
 * observational ones), the outcome-tier tally, and the trail for every trial;
 * prints the ceiling line when an observational case passed every trial; and
 * asserts the case did not alarm per {@link caseAlarms}.
 */
function gateOpCase(c: OpCase, run: CaseRun): void {
  const { trials } = run;
  const passed = trials.filter((t) => t.matched).length;
  const total = trials.length;
  const observational = c.observational !== undefined;
  const alarms = caseAlarms({ passed, total, hardFailed: run.hardFailed, observational });
  const atCeiling = isAtCeiling({ passed, total, observational });

  const outcomeTally = computeOutcomes(
    trials.map((t) =>
      classifyTrialOutcome({
        matched: t.matched,
        skillMdRead: t.skillMdRead,
        skillCalledAsTool: t.skillCalledAsTool,
      }),
    ),
  );
  const trailSummary = trials
    .map((t, i) => formatTrial(t, i, c.expect.command, c.expect.keyArgs))
    .join("\n");

  console.log(
    `${c.name} — rate ${passed}/${total}${observational ? " (observational)" : ""} ` +
      `(clean-pass ${outcomeTally.cleanPass}, warned-pass ${outcomeTally.warnedPass}, ` +
      `content-fail ${outcomeTally.contentFail}, never-reached ${outcomeTally.neverReached})\n${trailSummary}`,
  );
  if (atCeiling) {
    console.log(`${c.name} — at ceiling — consider promoting`);
  }

  expect(
    alarms,
    `"${c.name}" alarmed at ${passed}/${total} for command "${c.expect.command}". Trails:\n${trailSummary}`,
  ).toBe(false);
}

describe("gate — progressive", () => {
  it.each(progressiveOpCases)(
    "$name — weaver is invoked within the step budget across trials",
    async (c) => {
      const run = await runCaseTrials(c, callModel, BASE_TRIAL_COUNT);
      gateOpCase(c, run);
    },
    PROGRESSIVE_TIMEOUT_MS,
  );
});

describe("gate — front-loaded", () => {
  it.each(frontLoadedCases)(
    "$name — model emits the correct weaver command within the step budget across trials",
    async (c) => {
      const run = await runCaseTrials(c, callModel, BASE_TRIAL_COUNT);
      gateOpCase(c, run);
    },
    FRONT_LOADED_TIMEOUT_MS,
  );
});

describe("gate — boundary", () => {
  it.each(boundaryCases)(
    "$name — the model stays in bash across trials",
    async (c) => {
      const trials: AgenticResult[] = [];
      for (let i = 0; i < BASE_TRIAL_COUNT; i++) {
        trials.push(await runTrial(c, callModel));
      }

      const cleanCount = trials.filter((t) => boundaryTrialClean(t)).length;
      const trailSummary = trials
        .map((t, i) => {
          const status = boundaryTrialClean(t) ? "clean" : "OVER-TRIGGERED";
          const skillNote = t.skillMdRead ? ", skill loaded" : "";
          const trail = t.trail.map(formatCall).join(" → ") || "(no tool calls)";
          return `  trial ${i + 1} [${status}${skillNote}]: ${trail}`;
        })
        .join("\n");

      console.log(`${c.name} — ${cleanCount}/${trials.length} clean\n${trailSummary}`);

      expect(
        trials.every((t) => boundaryTrialClean(t)),
        `"${c.name}" over-triggered in at least one trial — a boundary case must stay clean (no skill load, no weaver call) across all trials. Trails:\n${trailSummary}`,
      ).toBe(true);
    },
    BOUNDARY_TIMEOUT_MS,
  );
});
