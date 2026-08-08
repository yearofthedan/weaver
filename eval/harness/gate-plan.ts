import type { GatingModel } from "./config.js";

/** One child `pnpm eval` invocation the runner spawns for a single roster model. */
export interface GateRunPlan {
  /** OpenRouter model id, sent to the child as WEAVER_EVAL_MODEL. */
  modelId: string;
  /** Trial count for this model's run, sent to the child as WEAVER_EVAL_TRIALS. */
  trials: number;
  /** argv passed to `pnpm`, e.g. `["eval", "--disable-console-intercept"]`. */
  argv: string[];
}

export interface GatePlanOptions {
  /** Caller-set WEAVER_EVAL_TRIALS; wins over every model's roster trial count when non-empty. */
  trialsOverride?: string;
  /** Extra argv (e.g. `-t <case-regex>`) forwarded to every child run unchanged. */
  extraArgv?: readonly string[];
}

// A set-but-non-numeric override throws rather than reaching the child as
// "NaN", where every case would run zero trials and alarm — a wasted run that
// reads as a suite-wide regression instead of a typo.
function resolveTrials(model: GatingModel, trialsOverride: string | undefined): number {
  if (trialsOverride === undefined || trialsOverride === "") {
    return model.baseTrials;
  }
  const parsed = Number(trialsOverride);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`WEAVER_EVAL_TRIALS must be a positive integer, got "${trialsOverride}"`);
  }
  return parsed;
}

/**
 * Builds one run plan per roster model, in roster order. Pure — the caller
 * supplies any environment-derived values (a WEAVER_EVAL_TRIALS override,
 * extra argv) rather than this module reading `process.env` or `process.argv`
 * itself, so the plan is fully exercised by unit tests without a child
 * process.
 */
export function buildGatePlans(
  roster: readonly GatingModel[],
  options: GatePlanOptions = {},
): GateRunPlan[] {
  const extraArgv = options.extraArgv ?? [];
  return roster.map((model) => ({
    modelId: model.id,
    trials: resolveTrials(model, options.trialsOverride),
    argv: ["eval", "--disable-console-intercept", ...extraArgv],
  }));
}

// Coupled to the exact line gate.llm.test.ts's afterAll prints:
// `eval run cost — $${getTotalCost().toFixed(4)}`. Update this pattern if that line's format changes.
const COST_LINE = /eval run cost — \$([\d.]+)/;

/**
 * Extracts the reported cost from a child eval run's captured output.
 * Returns undefined — never $0 — when the line is absent, so a run that
 * crashed before reporting never reads as a free one.
 */
export function extractRunCost(output: string): number | undefined {
  const match = output.match(COST_LINE);
  return match ? Number.parseFloat(match[1]) : undefined;
}
