/**
 * The four-tier classification of a single agentic trial, separating
 * weaver's own content signal from host-exposure noise:
 *
 * - `"clean-pass"` — the model selected the right operation without ever
 *   reaching for a skill as a tool. The content and the description both did
 *   their job.
 * - `"warned-pass"` — the model reached the right operation, but only after
 *   calling a skill directly as a tool rather than loading it the sanctioned
 *   way. The content still guided it; the host's exposure of skills is what's
 *   noisy.
 * - `"content-fail"` — the skill's body was read (via a load or a tool-style
 *   call) but did not guide the model to the right operation. A body to fix.
 * - `"never-reached"` — the model never read the skill at all. A description
 *   or shell-habit problem, not a body problem.
 */
export type TrialOutcome = "clean-pass" | "warned-pass" | "content-fail" | "never-reached";

/**
 * Classifies a trial's outcome from its raw signals. `matched` is the
 * existing selection verdict; `skillMdRead` and `skillCalledAsTool` come
 * straight off {@link import("./agentic-loop.js").AgenticResult}.
 *
 * `skillCalledAsTool` only distinguishes between the two passing tiers — a
 * miss is tiered on `skillMdRead` alone, since `skillCalledAsTool` implies
 * `skillMdRead` and so carries no extra information on that branch.
 */
export function classifyTrialOutcome(input: {
  matched: boolean;
  skillMdRead: boolean;
  skillCalledAsTool: boolean;
}): TrialOutcome {
  const { matched, skillMdRead, skillCalledAsTool } = input;
  if (matched) {
    return skillCalledAsTool ? "warned-pass" : "clean-pass";
  }
  return skillMdRead ? "content-fail" : "never-reached";
}

export interface OutcomeTally {
  cleanPass: number;
  warnedPass: number;
  contentFail: number;
  neverReached: number;
  /** Total number of outcomes tallied; equals the sum of the four counts above. */
  total: number;
}

/**
 * Aggregates N trial outcomes into per-tier counts plus a total. Reporting
 * only — carries no pass/fail assertion; `caseAlarms` remains the gate.
 */
export function computeOutcomes(outcomes: TrialOutcome[]): OutcomeTally {
  const tally: OutcomeTally = {
    cleanPass: 0,
    warnedPass: 0,
    contentFail: 0,
    neverReached: 0,
    total: outcomes.length,
  };
  for (const outcome of outcomes) {
    switch (outcome) {
      case "clean-pass":
        tally.cleanPass += 1;
        break;
      case "warned-pass":
        tally.warnedPass += 1;
        break;
      case "content-fail":
        tally.contentFail += 1;
        break;
      case "never-reached":
        tally.neverReached += 1;
        break;
    }
  }
  return tally;
}
