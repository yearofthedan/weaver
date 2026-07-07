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
  /** True if `matches` returned true for a call within `maxSteps`. */
  matched: boolean;
  /** 1-based step at which `matches` first returned true; absent if never. */
  matchedAtStep?: number;
  /** Every tool call the model made that was not a SKILL.md read, in order. */
  trail: ToolCall[];
  /** How many model turns were taken (≤ `maxSteps`). */
  steps: number;
  /** True if a SKILL.md read was observed at any point during the run. */
  skillMdRead: boolean;
  /** 1-based step of the first SKILL.md read; absent if none occurred. */
  readTurn?: number;
}

/**
 * Drives the model forward up to `maxSteps` turns, feeding a canned result back
 * after each turn, and reports whether the model reaches a call satisfying
 * `matches` — its *eventual* selection, not just its first call. This credits a
 * sensible precursor (e.g. find-references before a rename) that the single-shot
 * first-call metric scores as a loss.
 *
 * When `isSkillMdRead` returns true for a call, the loop records the read
 * (setting `skillMdRead` and `readTurn` on first occurrence) but does not add
 * it to `trail` and does not treat it as a match — it is a navigation step
 * toward the operation, not the operation itself.
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
  matches: (call: ToolCall) => boolean;
  isSkillMdRead: (call: ToolCall) => boolean;
  maxSteps: number;
  step: ModelStep;
  cannedResultFor: (call: ToolCall) => string;
}): Promise<AgenticResult> {
  const { tools, matches, isSkillMdRead, maxSteps, step, cannedResultFor } = params;
  const messages = [...params.messages];
  const trail: ToolCall[] = [];
  let skillMdRead = false;
  let readTurn: number | undefined;

  for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex++) {
    const response = await step(messages, tools);
    const calls = response.toolCalls;

    if (calls.length === 0) {
      // Model answered with text instead of a tool call — it has abandoned the
      // tools and will not converge. Stop here rather than burn the budget.
      return { matched: false, trail, steps: stepIndex, skillMdRead, readTurn };
    }

    const call = calls[0];

    if (isSkillMdRead(call)) {
      if (!skillMdRead) {
        skillMdRead = true;
        readTurn = stepIndex;
      }
      messages.push(
        { role: "assistant", content: `I'll use ${call.name}.` },
        { role: "user", content: `Output of ${call.name}:\n${cannedResultFor(call)}\n\nContinue.` },
      );
      continue;
    }

    trail.push(...calls);

    if (calls.some((c) => matches(c))) {
      return {
        matched: true,
        matchedAtStep: stepIndex,
        trail,
        steps: stepIndex,
        skillMdRead,
        readTurn,
      };
    }

    messages.push(
      { role: "assistant", content: `I'll use ${call.name}.` },
      { role: "user", content: `Output of ${call.name}:\n${cannedResultFor(call)}\n\nContinue.` },
    );
  }

  return { matched: false, trail, steps: maxSteps, skillMdRead, readTurn };
}
