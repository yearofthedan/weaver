import type { CaseEntry } from "../cases/cases.js";
import type { ChatMessage } from "./call-model.js";
import { isCleanMode } from "./config.js";
import { buildHabitMomentumSeed } from "./seed.js";

/**
 * Builds the seed conversation for a case's `momentumTurns`, defaulting to a
 * single pre-step when the field is absent — the current, pre-pressure-ladder
 * behaviour. Clean mode (`WEAVER_EVAL_CLEAN`) drops momentum turns entirely,
 * regardless of what the case requests.
 */
export function seedForCase(c: CaseEntry): ChatMessage[] {
  return buildHabitMomentumSeed(c.task, isCleanMode() ? 0 : (c.momentumTurns ?? 1));
}
