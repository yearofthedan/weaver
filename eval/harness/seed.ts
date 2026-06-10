import type { ChatMessage, ToolCall } from "./call-model.js";

/**
 * Builds the pre-seeded message array for a two-step eval case.
 *
 * Produces three messages:
 *   1. User: the original task
 *   2. Assistant: a tool_use call representing the step-1 weaver command
 *   3. Tool result: the canned fixture JSON as the tool_result content
 *
 * The fixture content is embedded verbatim as a string — the model sees
 * exactly what it would see if it had run the step-1 command.
 */
export function buildSeedMessages(
  task: string,
  step1ToolCall: ToolCall,
  fixtureContent: string,
): ChatMessage[] {
  const toolCallId = step1ToolCall.id ?? "step1_call";
  return [
    {
      role: "user",
      content: task,
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [step1ToolCall],
    },
    {
      role: "tool",
      content: fixtureContent,
      tool_call_id: toolCallId,
    },
  ];
}
