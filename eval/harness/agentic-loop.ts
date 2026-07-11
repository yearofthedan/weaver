import { OPERATION_NAMES } from "../../src/daemon/dispatcher.js";
import { extractBashCommands, isAnyWeaverInvocation, weaverSubcommand } from "./assertions.js";
import type { ChatMessage, ModelResponse, ToolCall, ToolDefinition } from "./call-model.js";
import { loadFixture, operationToSubcommand } from "./fixtures.js";

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
 * Global default result for each weaver subcommand, keyed by the kebab-case
 * subcommand name — one entry per registered operation, sourced from its
 * `eval/fixtures/<operation>.json` stub. Used as the fallback when a scenario
 * doesn't own a result for a weaver call it happens to make.
 */
const WEAVER_SUBCOMMAND_DEFAULTS: Record<string, string> = Object.fromEntries(
  OPERATION_NAMES.map((operation) => [operationToSubcommand(operation), loadFixture(operation)]),
);

/**
 * Returns the canned result to feed back for a tool call, letting a scenario
 * override the result for a specific subcommand or tool name via `caseResults`.
 *
 * Weaver-faithful-stub contract: a bash call that invokes `weaver` always
 * resolves to a weaver-shaped result (the case override, or the fixture
 * default for that subcommand) — it never falls back to the generic bash file
 * list, and an unmapped subcommand throws rather than silently returning one.
 *
 * A non-weaver bash call, or any other declared tool, resolves the case
 * override first and then the global canned result; an unmapped non-bash tool
 * still throws — a guard against the lane's tool set drifting ahead of this map.
 */
export function cannedToolResult(call: ToolCall, caseResults?: Record<string, string>): string {
  if (call.name === "bash") {
    const command = typeof call.arguments.command === "string" ? call.arguments.command : "";
    const subcommand = weaverSubcommand(command);
    if (subcommand !== undefined) {
      const result = caseResults?.[subcommand] ?? WEAVER_SUBCOMMAND_DEFAULTS[subcommand];
      if (result === undefined) {
        throw new Error(`No weaver stub for subcommand "${subcommand}"`);
      }
      return result;
    }
    return caseResults?.bash ?? CANNED_RESULTS.bash;
  }

  const result = caseResults?.[call.name] ?? CANNED_RESULTS[call.name];
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
  /**
   * The model's text reply on the turn it stopped emitting tool calls; absent
   * if the run matched or exhausted the step budget. This is the evidence for
   * diagnosing *why* a trial abandoned — e.g. answering from priors after a
   * skill load instead of acting on it.
   */
  abandonedText?: string;
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
 * Each completed turn is replayed as a standard tool-use exchange: the model's
 * own assistant message (its text and real `tool_calls`) followed by a
 * `tool`-role result for every call. The model is stateless, so this faithful
 * history is what lets it advance across hops instead of re-planning from
 * scratch — a lossy echo strands multi-hop trajectories on their first call.
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

  // Opt-in tracing of the full turn-by-turn exchange (model text, the tool call,
  // and the exact result fed back) for diagnosing why a trial does not converge.
  const debug = process.env.WEAVER_EVAL_DEBUG === "1";

  // A call whose arguments were malformed JSON gets a host-style error fed
  // back instead of a canned result, so the model can retry rather than the
  // run crashing.
  const resultTextFor = (call: ToolCall): string =>
    call.invalidArguments === undefined
      ? cannedResultFor(call)
      : `Error: arguments for tool "${call.name}" were not valid JSON: ${call.invalidArguments}`;

  // Replay a completed turn as a standard tool exchange: the model's assistant
  // message with its real tool_calls, then a tool-role result for every call.
  // An OpenAI-compatible endpoint rejects the next request if any tool_call in
  // the assistant message has no matching tool response, so answer them all.
  // Each call is given a concrete id (some providers omit it) so the assistant
  // tool_calls and their tool responses reference the same one.
  const echoTurn = (text: string, calls: ToolCall[], turn: number): void => {
    const withIds = calls.map((call, i) =>
      call.id === undefined ? { ...call, id: `call_${turn}_${i}` } : call,
    );
    messages.push({ role: "assistant", content: text || null, tool_calls: withIds });
    for (const call of withIds) {
      const result = resultTextFor(call);
      if (debug) {
        console.error(`  ← ${call.name} result:\n${indent(truncate(result, 800))}`);
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  };

  if (debug) {
    console.error("═══ initial prompt ═══");
    for (const message of messages) {
      const toolCalls = message.tool_calls
        ?.map((c) => `${c.name}(${JSON.stringify(c.arguments)})`)
        .join(", ");
      const body = message.content ?? (toolCalls ? `→ ${toolCalls}` : "");
      const label = message.tool_call_id ? `${message.role} ${message.tool_call_id}` : message.role;
      console.error(`\n[${label}]\n${indent(truncate(body, 4000))}`);
    }
  }

  for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex++) {
    const response = await step(messages, tools);
    const calls = response.toolCalls;

    if (calls.length === 0) {
      // Model answered with text instead of a tool call — it has abandoned the
      // tools and will not converge. Stop here rather than burn the budget.
      return {
        matched: false,
        trail,
        steps: stepIndex,
        skillMdRead,
        readTurn,
        abandonedText: response.text,
      };
    }

    const call = calls[0];

    if (debug) {
      const arg =
        call.name === "bash"
          ? String(call.arguments.command ?? "")
          : JSON.stringify(call.arguments);
      console.error(`\n─ step ${stepIndex} ─ model said: ${JSON.stringify(response.text)}`);
      console.error(`  → ${call.name}(${arg})`);
    }

    if (isSkillMdRead(call)) {
      if (!skillMdRead) {
        skillMdRead = true;
        readTurn = stepIndex;
      }
      echoTurn(response.text, calls, stepIndex);
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

    echoTurn(response.text, calls, stepIndex);
  }

  return { matched: false, trail, steps: maxSteps, skillMdRead, readTurn };
}

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}… (${text.length - max} more chars)`;

const indent = (text: string): string =>
  text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

/**
 * Returns true when a boundary trial stayed in the shell the whole way: no
 * skill was loaded, and no call in `trail` reached `weaver` for any
 * subcommand. Either signal alone is an over-trigger — a skill load that
 * never converts to a `weaver` call has still stolen the model's attention
 * from a legitimate shell task, and a `weaver` call without a prior load
 * would mean the model already knew to skip the skill and go straight to
 * the CLI, which is just as much a boundary violation.
 */
export function boundaryTrialClean(result: Pick<AgenticResult, "skillMdRead" | "trail">): boolean {
  if (result.skillMdRead) return false;
  return !extractBashCommands(result.trail).some((cmd) => isAnyWeaverInvocation(cmd));
}
