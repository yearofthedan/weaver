export interface RateResult {
  passed: number;
  total: number;
  /** `passed / total`, or `0` when `total` is zero. */
  rate: number;
  /**
   * True when the rate is strictly below the 2/3 alarm floor — meaning at
   * least 2 out of every 3 trials must succeed to avoid an alarm. An empty
   * result set (total === 0) yields rate 0, which is below the floor.
   */
  belowAlarm: boolean;
}

/**
 * Aggregates N trial verdicts for a single eval scenario. Reports the pass
 * rate and flags below-2/3 rates as an informal alarm.
 *
 * The 2/3 floor is inclusive: a 2/3 rate is at the floor, not below it.
 */
export function computeRate(results: boolean[]): RateResult {
  const total = results.length;
  const passed = results.filter(Boolean).length;
  const rate = total === 0 ? 0 : passed / total;
  return {
    passed,
    total,
    rate,
    belowAlarm: rate < 2 / 3,
  };
}
