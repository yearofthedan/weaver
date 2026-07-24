import { SKILL_NAMES, skillContext } from "../harness/context.js";

/** Full skill content (every SKILL.md body) — the command-stage lanes put this in context. */
export const skillContent = skillContext([...SKILL_NAMES]);

/**
 * The clean command-stage prompt: skill content, the task, and a single-call
 * instruction. Shared by the clean command lane and the pressured-emission lane
 * so the pressured lane grades the same emission the clean lane does — a change
 * to this wording must move both, not silently diverge them.
 */
export function commandPrompt(task: string): string {
  return `${skillContent}\n\n---\n\nTask: ${task}\n\nUse the bash tool to make a single call that accomplishes this task.`;
}
