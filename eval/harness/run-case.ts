import type { CaseEntry } from "../cases/cases.js";
import { type AgenticResult, type ModelStep, runAgenticLoop } from "./agentic-loop.js";
import { buildTrialConfig } from "./case-lane.js";
import { decideEscalation } from "./verdict.js";

/** Runs one trial for `c`: assembles the exposure-specific config and drives it through {@link runAgenticLoop}. */
export async function runTrial(c: CaseEntry, step: ModelStep): Promise<AgenticResult> {
  return runAgenticLoop({ ...buildTrialConfig(c), step });
}

export interface CaseRun {
  trials: AgenticResult[];
  /** True when any trial hard-failed on a mutating competitor — alarms the case regardless of rate. */
  hardFailed: boolean;
}

/**
 * Runs `baseTrials` trials for `c`, then consults {@link decideEscalation} on
 * the base result: a case at or above the 2/3 floor stops there, a case below
 * it runs the additional trials needed to reach the escalated total. Returns
 * every trial run (base plus any escalation) and whether any trial hard-failed.
 */
export async function runCaseTrials(
  c: CaseEntry,
  step: ModelStep,
  baseTrials: number,
): Promise<CaseRun> {
  const trials: AgenticResult[] = [];
  for (let i = 0; i < baseTrials; i++) {
    trials.push(await runTrial(c, step));
  }

  const passed = trials.filter((t) => t.matched).length;
  // decideEscalation guarantees additionalTrials is 0 whenever escalate is
  // false, so the loop is already a no-op in that case — no separate branch
  // needed on `escalate` itself.
  const { additionalTrials } = decideEscalation(passed, trials.length);
  for (let i = 0; i < additionalTrials; i++) {
    trials.push(await runTrial(c, step));
  }

  return { trials, hardFailed: trials.some((t) => t.failedAtStep !== undefined) };
}
