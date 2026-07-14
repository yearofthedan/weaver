import { describe, expect, it } from "vitest";
import { cannedToolResult, runAgenticLoop } from "../harness/agentic-loop.js";
import {
  extractBashCommands,
  isWeaverInvocation,
  matchWeaverCommand,
} from "../harness/assertions.js";
import { type ChatMessage, callModel, type ToolCall } from "../harness/call-model.js";
import { modelConfig } from "../harness/config.js";
import { SKILL_NAMES, skillContext } from "../harness/context.js";
import { BASH_TOOL } from "../harness/tools.js";
import { CASES } from "./cases.js";

// No skill-load hop here — the skill content is inlined in the prompt rather
// than loaded via a Skill tool — so the budget only spans precursor(s) plus the
// operation. Common trajectories are 1 step (single-shot) or 2 (one precursor
// then the op).
const MAX_STEPS = 3;

/** Single-step command cases (no seed). */
const singleStepCases = CASES.filter((c) => c.stage === "command" && !c.seed);

const skillContent = skillContext([...SKILL_NAMES]);

function commandPrompt(task: string): string {
  // The full skill content is in context; the prompt deliberately does not name
  // weaver, so the model must still select it. Unlike the trigger lane there is
  // no clutter prompt and no habit-momentum seed — this is the clean-room
  // correctness lane.
  return `${skillContent}\n\n---\n\nTask: ${task}\n\nUse the bash tool to accomplish this task.`;
}

/**
 * Renders a tool call with its raw arguments. For bash the command string is
 * the evidence, so a name-only trail cannot distinguish "never ran weaver"
 * from a matcher false-negative.
 */
function formatCall(call: ToolCall): string {
  const args =
    call.name === "bash" ? String(call.arguments.command ?? "") : JSON.stringify(call.arguments);
  return `${call.name}(${args})`;
}

describe("command-stage cases", () => {
  it.each(singleStepCases)("$name — model emits correct weaver command", async (c) => {
    const { command, keyArgs } = c.expect;
    expect(command, "command case must declare expect.command").toBeDefined();
    if (!command) return;

    const messages: ChatMessage[] = [{ role: "user", content: commandPrompt(c.task) }];

    // Deterministic correctness lane: a single trajectory at temperature 0 (no
    // trials loop), crediting a benign precursor and asserting the *eventual*
    // weaver call. This must not become a rate lane — the agentic lane owns
    // selection-under-pressure; this lane owns argument fidelity.
    const result = await runAgenticLoop({
      messages,
      tools: [BASH_TOOL],
      // Stop at the first bash call that commits to the expected subcommand
      // (subcommand only). Arguments are graded after the loop so a wrong-args
      // commit is diagnosed rather than looped past to the step budget.
      matches: (call) =>
        call.name === "bash" &&
        extractBashCommands([call]).some((cmd) => isWeaverInvocation(cmd, command)),
      isSkillMdRead: () => false,
      maxSteps: MAX_STEPS,
      step: (msgs, tools) => callModel(msgs, tools, { ...modelConfig(), temperature: 0 }),
      cannedResultFor: (call) => cannedToolResult(call, c.cannedResults),
    });

    const trailSummary = `${result.trail.map(formatCall).join(" → ") || "(no tool calls)"}${
      result.abandonedText !== undefined
        ? `\n  abandoned with text: ${JSON.stringify(result.abandonedText.slice(0, 500))}`
        : ""
    }`;

    // Selection: never reaching the expected subcommand within the budget is a
    // wrong-tool miss (no weaver at all, or a different op the model settled on).
    expect(
      result.matched,
      `never reached "weaver ${command}" within ${MAX_STEPS} steps for task: "${c.task}".\nTrail: ${trailSummary}`,
    ).toBe(true);
    if (!result.matched) return;

    // Argument fidelity is gating: the committed segment must parse as
    // `weaver <command> '<json>'` with the case's key arguments. A right-op /
    // wrong-args commit fails here as "wrong-args" with the offending command.
    const segment = extractBashCommands(result.trail).find((cmd) =>
      isWeaverInvocation(cmd, command),
    );
    expect(segment, `matched but no weaver segment found in trail: ${trailSummary}`).toBeDefined();
    if (!segment) return;

    const match = matchWeaverCommand(segment, command, keyArgs);
    expect(
      match.outcome,
      `reached "weaver ${command}" but its arguments were not correct for task: "${c.task}".\n` +
        `Command: ${segment}\nReason: ${match.reason}\nTrail: ${trailSummary}`,
    ).toBe("correct");
  });
});
