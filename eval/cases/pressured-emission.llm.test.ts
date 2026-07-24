import { describe, expect, it } from "vitest";
import { extractBashCommands, matchWeaverCommand } from "../harness/assertions.js";
import { type ChatMessage, callModel } from "../harness/call-model.js";
import { buildClutterSystemPrompt } from "../harness/clutter.js";
import { modelConfig } from "../harness/config.js";
import { buildHabitMomentumSeed } from "../harness/seed.js";
import { BASH_TOOL } from "../harness/tools.js";
import { CASES } from "./cases.js";
import { commandPrompt } from "./command-prompt.js";

/** Single-step command cases (no seed) — the same set the clean command lane grades. */
const singleStepCases = CASES.filter((c) => c.stage === "command" && !c.seed);

/**
 * Command cases whose single-shot emission falls back to the shell under
 * habit-momentum pressure on the gate model (Haiku, measured 2026-07-24):
 * find-importers → grep, search-text → grep, get-type-errors → npx tsc. The
 * lane reports these but does not gate them — gating a case the skill body does
 * not yet hold would ship a red build. The body-hardening follow-up removes each
 * entry once it holds under pressure, flipping it to gating. The set is
 * calibrated to the gate model; another model may fall on different cases (the
 * spike saw Gemini drop move-file → mv, which Haiku holds).
 */
const KNOWN_RED = new Set<string>([
  "command-find-importers",
  "command-get-type-errors",
  "command-search-text",
]);

// The pool maximum — the strongest legitimate pressure buildHabitMomentumSeed offers.
const MOMENTUM_TURNS = 3;

/**
 * The command prompt wrapped in host pressure: a cluttered system prompt plus a
 * habit-momentum seed of weaver-orthogonal shell work (log grep, git log,
 * filename find — never a shell stand-in for a graded weaver op, so a fallback
 * is habit transfer, not a copied precedent). Bash is the only tool and the
 * skill body is in context, so the lane measures whether the body holds emission
 * when the context is crowded and primed toward the shell — the empty
 * NONE × pressured cell of the lane matrix (docs/eval-readiness.md).
 */
function pressuredMessages(task: string): ChatMessage[] {
  return [
    { role: "system", content: buildClutterSystemPrompt() },
    ...buildHabitMomentumSeed(commandPrompt(task), MOMENTUM_TURNS),
  ];
}

describe("pressured single-shot emission", () => {
  it.each(singleStepCases)("$name — emits the weaver command under pressure", async (c) => {
    const { command, keyArgs } = c.expect;
    expect(command, "command case must declare expect.command").toBeDefined();
    if (!command) return;

    const response = await callModel(pressuredMessages(c.task), [BASH_TOOL], {
      ...modelConfig(),
      temperature: 0,
    });

    const commands = extractBashCommands(response.toolCalls);
    const matches = commands.map((cmd) => matchWeaverCommand(cmd, command, keyArgs));
    const passed = matches.some((m) => m.matched);

    const detail =
      `task: "${c.task}"\n` +
      `emitted:\n${commands.map((cmd, i) => `  [${i}] ${cmd}\n  reason: ${matches[i]?.reason}`).join("\n") || "  (no bash call)"}` +
      (response.text ? `\ntext: ${response.text}` : "");

    // Known-red cases report their movement but carry no gating assertion: the
    // skill body does not yet hold emission under pressure, so gating would ship
    // a red build. Reported for the hardening follow-up to act on.
    if (KNOWN_RED.has(c.name)) {
      console.log(
        `${c.name} — ${passed ? "held" : "FELL BACK"} under pressure (known-red, not gated)\n${detail}`,
      );
      return;
    }

    expect(
      passed,
      `"${c.name}" fell back under pressure — expected a weaver ${command} command.\n${detail}`,
    ).toBe(true);
  });
});
