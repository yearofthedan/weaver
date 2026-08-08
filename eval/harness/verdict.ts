/** Trial count for a case's first pass. */
export const BASE_TRIALS = 3;
/** Total trial count after escalation — the same 2/3 floor read at higher resolution, not a stricter bar. */
export const ESCALATED_TRIALS = 6;

/**
 * `passed / total < 2 / 3`, compared as integers so the boundary is exact at
 * any trial count. The floor is inclusive: exactly 2/3 clears.
 *
 * No trials at all is below the floor. Integer comparison would otherwise read
 * 0/0 as clearing, so a harness fault that ran nothing would gate green.
 */
export function belowFloor(passed: number, total: number): boolean {
  if (total === 0) return true;
  return passed * 3 < total * 2;
}

export interface EscalationDecision {
  escalate: boolean;
  /** Trials still needed to reach {@link ESCALATED_TRIALS}; 0 when not escalating. */
  additionalTrials: number;
}

/**
 * Whether a case's result at {@link BASE_TRIALS} needs a second round, and how
 * many more trials that takes.
 *
 * A case that cleared the floor but did not sweep clean (e.g. 2/3) still
 * escalates: the record has a 2/3 that was truly 3/10 once run at higher
 * resolution, so an unresolved partial failure is read the same as a
 * below-floor one, not as a pass. Escalation is also bounded by
 * {@link ESCALATED_TRIALS} — a case already at or past that total has no
 * headroom left to escalate into, regardless of its rate.
 */
export function decideEscalation(passed: number, total: number): EscalationDecision {
  const hasHeadroom = total < ESCALATED_TRIALS;
  const sweptClean = passed === total;
  const escalate = hasHeadroom && (belowFloor(passed, total) || !sweptClean);
  return { escalate, additionalTrials: escalate ? ESCALATED_TRIALS - total : 0 };
}

/**
 * Whether an observational marker's model list demotes a case's result on
 * the given active model. `undefined` means the case carries no marker at
 * all, which never demotes — the case gates normally on every model.
 */
export function isDemotedForModel(
  models: readonly string[] | undefined,
  activeModel: string,
): boolean {
  return (models ?? []).includes(activeModel);
}

/**
 * Whether a case's final result should alarm. A hard-failed trial
 * (`isMutatingCompetitor`) alarms the case regardless of rate or
 * observational marking — a destructive act is never merely observational.
 * Otherwise an observational case never alarms on rate; a normal case
 * alarms below the 2/3 floor.
 */
export function caseAlarms(input: {
  passed: number;
  total: number;
  hardFailed: boolean;
  observational: boolean;
}): boolean {
  if (input.hardFailed) {
    return true;
  }
  if (input.observational) {
    return false;
  }
  return belowFloor(input.passed, input.total);
}

/** True when an observational case passed every trial — reportable as "at ceiling — consider promoting". */
export function isAtCeiling(input: {
  passed: number;
  total: number;
  observational: boolean;
}): boolean {
  return input.observational && input.total > 0 && input.passed === input.total;
}
