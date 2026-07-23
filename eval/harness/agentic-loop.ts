import { extractBashCommands, isAnyWeaverInvocation, weaverSubcommand } from "./assertions.js";
import type { ChatMessage, ModelResponse, ToolCall, ToolDefinition } from "./call-model.js";

/**
 * Canned tool output fed back after each loop turn, keyed by the tool name the
 * model called. Results only have to look plausible enough to keep the model
 * moving — they are never asserted on. Skills are not tools: they load via
 * Skill()/Read, and a call naming one directly is a hallucination handled by
 * resolveCannedResult, so only the actual host tools (bash + the competing
 * editing/search tools) need an entry. An unknown declared tool throws so a
 * drifted tool set fails loud instead of feeding an empty string.
 */
const CANNED_RESULTS: Record<string, string> = {
  Edit: "Edit applied.",
  Grep: "src/auth.ts:12:  userId\nsrc/api.ts:8:  userId",
  Glob: "src/auth.ts\nsrc/api.ts",
  Read: "export function authenticate(userId: string) { /* ... */ }",
  bash: "src/auth.ts\nsrc/api.ts\nsrc/utils.ts",
};

/**
 * Fed back for a `weaver <sub>` bash call whose subcommand the case does not
 * own. Deliberately inert — a scenario-coherent result is only available via
 * a case's `cannedResults`; falling back to another operation's fixture or
 * the generic bash file list would feed the model mismatched scenario data
 * on a hop the case never anticipated.
 */
const NEUTRAL_WEAVER_RESULT = "No results for this call.";

/**
 * Returns the canned result to feed back for a tool call, letting a scenario
 * override the result for a specific subcommand or tool name via `caseResults`.
 *
 * A bash call that invokes `weaver` resolves the case's override for that
 * subcommand, falling back to the inert `NEUTRAL_WEAVER_RESULT` stub — never
 * the generic bash file list, and never another operation's fixture content.
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
      return caseResults?.[subcommand] ?? NEUTRAL_WEAVER_RESULT;
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
 * Resolves the result for a tool call given the lane's declared tool set. A
 * call to a name the lane never declared is a hallucinated tool (a model
 * inventing a tool, in whatever separator style — `weaver_code_inspection`,
 * `frobnicate`); it gets the host-style "no such tool" error so the trial is
 * graded as the miss it is, rather than crashing on a missing canned result.
 * A declared tool still routes to {@link cannedToolResult}, which throws only
 * when a declared tool has no canned result — a real harness gap (tool set
 * drifted ahead of the map), kept loud on purpose.
 */
export function resolveCannedResult(
  call: ToolCall,
  declaredToolNames: readonly string[],
  caseResults?: Record<string, string>,
): string {
  if (!declaredToolNames.includes(call.name)) {
    return `Error: no such tool "${call.name}". Available tools: ${declaredToolNames.join(", ")}.`;
  }
  return cannedToolResult(call, caseResults);
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
  /**
   * 1-based step at which a call satisfied `hardFails` (and no call that step
   * satisfied `matches`); absent if the run never hard-failed, including when
   * `hardFails` was not supplied.
   */
  failedAtStep?: number;
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
 * When `isSkillMdRead` returns true for a call — at any position in the turn,
 * not only the first call — the loop records the read (setting `skillMdRead`
 * and `readTurn` on first occurrence) but keeps it out of `trail` and the match
 * check: it is a navigation step toward the operation, not the operation
 * itself. A turn that bundles a skill-load with an operation call records both
 * facts; the load never suppresses a match or hard-fail on its sibling calls.
 *
 * Each completed turn is replayed as a standard tool-use exchange: the model's
 * own assistant message (its text and real `tool_calls`) followed by a
 * `tool`-role result for every call. The model is stateless, so this faithful
 * history is what lets it advance across hops instead of re-planning from
 * scratch — a lossy echo strands multi-hop trajectories on their first call.
 *
 * `hardFails` is an optional veto: when a call does not satisfy `matches` but
 * does satisfy `hardFails`, the loop records the call in `trail` and stops
 * immediately — it does not echo the turn or continue toward the step budget.
 * `matches` is checked first, so a call satisfying both is a match, not a
 * hard fail. Omitting `hardFails` reproduces today's run-to-budget behaviour.
 */
export async function runAgenticLoop(params: {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  matches: (call: ToolCall) => boolean;
  hardFails?: (call: ToolCall) => boolean;
  isSkillMdRead: (call: ToolCall) => boolean;
  maxSteps: number;
  step: ModelStep;
  cannedResultFor: (call: ToolCall) => string;
}): Promise<AgenticResult> {
  const { tools, matches, hardFails, isSkillMdRead, maxSteps, step, cannedResultFor } = params;
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

    if (debug) {
      const first = calls[0];
      const arg =
        first.name === "bash"
          ? String(first.arguments.command ?? "")
          : JSON.stringify(first.arguments);
      console.error(`\n─ step ${stepIndex} ─ model said: ${JSON.stringify(response.text)}`);
      console.error(`  → ${first.name}(${arg})`);
    }

    // A skill-load can appear anywhere in a turn, not just first — a model may
    // bundle it with a shell call fired in the same turn. Detect it across all
    // of the turn's calls (recording the read once, on the first turn it
    // appears) and keep every skill-load out of the trail and the match /
    // hard-fail checks: a load is navigation toward the operation, not the
    // operation. The remaining calls are the ones that count.
    if (!skillMdRead && calls.some((c) => isSkillMdRead(c))) {
      skillMdRead = true;
      readTurn = stepIndex;
    }

    // The non-skill-load calls are the ones that count. A pure navigation turn
    // (only skill-loads) leaves this empty, so nothing is trailed or matched and
    // the turn falls through to the echo below — the same as a spent turn.
    const operationCalls = calls.filter((c) => !isSkillMdRead(c));

    trail.push(...operationCalls);

    if (operationCalls.some((c) => matches(c))) {
      return {
        matched: true,
        matchedAtStep: stepIndex,
        trail,
        steps: stepIndex,
        skillMdRead,
        readTurn,
      };
    }

    if (hardFails !== undefined && operationCalls.some((c) => hardFails(c))) {
      return {
        matched: false,
        failedAtStep: stepIndex,
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
