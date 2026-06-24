import type { ChatMessage, ModelResponse, ToolCall, ToolDefinition } from "./call-model.js";

/**
 * Canned tool output fed back after each loop turn, keyed by the tool name the
 * model called. Results only have to look plausible enough to keep the model
 * moving — they are never asserted on. Every tool the lane declares (each skill,
 * each competing host tool, and bash) needs an entry; an unknown name throws so
 * a drifted tool set fails loud instead of feeding an empty string.
 */
const CANNED_RESULTS: Record<string, string> = {
  "weaver-search-and-replace": "src/auth.ts:12:  const v1 = config.v1;\nsrc/api.ts:5:  // v1 only",
  "weaver-refactor": "Renamed across 3 files. No conflicts.",
  "weaver-code-inspection":
    "src/auth.ts:5:17 - reference\nsrc/api.ts:8:3 - reference\n2 references found.",
  Edit: "Edit applied.",
  Grep: "src/auth.ts:12:  userId\nsrc/api.ts:8:  userId",
  Glob: "src/auth.ts\nsrc/api.ts",
  Read: "export function authenticate(userId: string) { /* ... */ }",
  bash: "src/auth.ts\nsrc/api.ts\nsrc/utils.ts",
};

/**
 * Returns the canned result to feed back for a tool call. Throws when the tool
 * name has no canned entry — a guard against the lane's tool set drifting ahead
 * of this map.
 */
export function cannedToolResult(call: ToolCall): string {
  const result = CANNED_RESULTS[call.name];
  if (result === undefined) {
    throw new Error(`No canned result for tool "${call.name}"`);
  }
  return result;
}

/**
 * The transport seam for {@link runAgenticLoop}: one model turn given the
 * current history and tools. `callModel` satisfies it directly; unit tests pass
 * a scripted fake so the loop's branching can be verified without a model server.
 */
export type ModelStep = (
  messages: ChatMessage[],
  tools: ToolDefinition[],
) => Promise<ModelResponse>;

export interface AgenticResult {
  /** True if `expectedTool` was called within `maxSteps`. */
  matched: boolean;
  /** 1-based step at which `expectedTool` was first called; absent if never. */
  matchedAtStep?: number;
  /** Every tool call the model made, in order — the convergence trail. */
  trail: ToolCall[];
  /** How many model turns were taken (≤ `maxSteps`). */
  steps: number;
}

/**
 * Drives the model forward up to `maxSteps` turns, feeding a canned result back
 * after each turn, and reports whether the model reaches `expectedTool` — its
 * *eventual* selection, not just its first call. This credits a sensible
 * precursor (e.g. find-references before a rename) that the single-shot
 * first-call metric scores as a loss.
 *
 * Completed turns are echoed as plain-text conversation turns, never as
 * tool_call/tool messages: Ollama silently drops seeded tool messages (see
 * docs/eval-design.md), so a tool-format echo would make the next turn measure
 * the wrong thing. The model still emits a fresh tool call each turn, which is
 * read straight from the response.
 */
export async function runAgenticLoop(params: {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  expectedTool: string;
  maxSteps: number;
  step: ModelStep;
  cannedResultFor: (call: ToolCall) => string;
}): Promise<AgenticResult> {
  const { tools, expectedTool, maxSteps, step, cannedResultFor } = params;
  const messages = [...params.messages];
  const trail: ToolCall[] = [];

  for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex++) {
    const response = await step(messages, tools);
    const calls = response.toolCalls;

    if (calls.length === 0) {
      // Model answered with text instead of a tool call — it has abandoned the
      // tools and will not converge. Stop here rather than burn the budget.
      return { matched: false, trail, steps: stepIndex };
    }

    trail.push(...calls);

    if (calls.some((call) => call.name === expectedTool)) {
      return { matched: true, matchedAtStep: stepIndex, trail, steps: stepIndex };
    }

    const call = calls[0];
    messages.push(
      { role: "assistant", content: `I'll use ${call.name}.` },
      { role: "user", content: `Output of ${call.name}:\n${cannedResultFor(call)}\n\nContinue.` },
    );
  }

  return { matched: false, trail, steps: maxSteps };
}
