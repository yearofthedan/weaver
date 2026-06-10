import type { ChatMessage } from "./call-model.js";

/**
 * Builds the pre-seeded message array for a two-step eval case, as plain
 * conversation turns:
 *
 *   1. User: the original task
 *   2. Assistant: the step-1 weaver command it "ran"
 *   3. User: the command's output (the canned fixture JSON, embedded verbatim)
 *      plus a prompt for the follow-up command
 *
 * Text turns rather than tool_call/tool messages: local-model servers parse
 * tool calls unreliably (Ollama silently drops calls it cannot parse), and the
 * assertion target is the command string either way.
 */
export function buildSeedMessages(
  task: string,
  step1Command: string,
  fixtureContent: string,
): ChatMessage[] {
  return [
    {
      role: "user",
      content: task,
    },
    {
      role: "assistant",
      content: step1Command,
    },
    {
      role: "user",
      content: `Output of \`${step1Command}\`:\n${fixtureContent}\n\nReply with ONLY the single shell command to run next. No explanation, no markdown.`,
    },
  ];
}
