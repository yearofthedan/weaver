import type { CaseEntry } from "../cases/cases.js";
import type { ChatMessage } from "./call-model.js";
import { buildHabitMomentumSeed } from "./seed.js";

/**
 * Builds the seed conversation for a case's `momentumTurns`, defaulting to a
 * single pre-step when the field is absent — the current, pre-pressure-ladder
 * behaviour.
 */
export function seedForCase(c: CaseEntry): ChatMessage[] {
  return buildHabitMomentumSeed(c.task, c.momentumTurns ?? 1);
}

/**
 * Returns whether the agentic trigger lane should gate on this case's
 * `belowAlarm` floor. Absent `observational` defaults to gating (`true`).
 */
export function caseIsGating(c: CaseEntry): boolean {
  return !(c.observational ?? false);
}
