import { describe, expect, it } from "vitest";
import { extractBashCommands, matchWeaverCommand } from "../harness/assertions.js";
import { type ChatMessage, callModel } from "../harness/call-model.js";
import { buildClutterSystemPrompt } from "../harness/clutter.js";
import { modelConfig } from "../harness/config.js";
import { buildHabitMomentumSeed } from "../harness/seed.js";
import { BASH_TOOL } from "../harness/tools.js";
import { CASES, type CaseEntry } from "./cases.js";
import { commandPrompt } from "./command-prompt.js";

/** Single-step command cases (no seed) — the same set the clean command lane grades. */
const singleStepCases = CASES.filter((c) => c.stage === "command" && !c.seed);

/**
 * The one command case whose single-shot emission still falls back to the shell
 * under habit-momentum pressure on the gate model (Haiku): get-type-errors →
 * `npx tsc`. `tsc` is the single most-habituated check-for-errors reflex, and
 * even a decision-path router with an explicit "Never: tsc/npx tsc" row does not
 * hold Haiku under momentum (measured 4/4 fell back) — unlike search-text, whose
 * identical router row holds. That asymmetry is under investigation (docs/handoff.md).
 *
 * It runs below as an `it.fails`, not in the gating set: the lane stays green
 * while the reflex legitimately can't be held, and turns red the moment a skill
 * or model change finally holds it — the signal to move it into the gating set.
 * find-importers, move-directory, and search-text were cleared this way; the
 * decision-path routers at the head of the three skills hold them under pressure.
 */
const EXPECTED_FALLBACK = "command-get-type-errors";

const gatingCases = singleStepCases.filter((c) => c.name !== EXPECTED_FALLBACK);
const fallbackCase = singleStepCases.find((c) => c.name === EXPECTED_FALLBACK);
if (!fallbackCase) {
  throw new Error(
    `EXPECTED_FALLBACK "${EXPECTED_FALLBACK}" matches no single-step command case — hold it under pressure and delete this, or fix the name.`,
  );
}

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

/** Emits the case under pressure and reports whether any bash call was the expected weaver command. */
async function runUnderPressure(
  c: CaseEntry,
): Promise<{ passed: boolean; command: string; detail: string }> {
  const { command, keyArgs } = c.expect;
  if (!command) throw new Error(`command case "${c.name}" must declare expect.command`);

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

  return { passed, command, detail };
}

describe("pressured single-shot emission", () => {
  it.each(gatingCases)("$name — emits the weaver command under pressure", async (c) => {
    const { passed, command, detail } = await runUnderPressure(c);
    expect(
      passed,
      `"${c.name}" fell back under pressure — expected a weaver ${command} command.\n${detail}`,
    ).toBe(true);
  });

  // Expected to fall back (see EXPECTED_FALLBACK). `it.fails` passes while the
  // case keeps falling back and fails the moment it holds — the promotion signal.
  it.fails(`${fallbackCase.name} — not yet held under pressure (tsc reflex)`, async () => {
    const { passed, command, detail } = await runUnderPressure(fallbackCase);
    console.log(
      `${fallbackCase.name} — ${passed ? "HELD under pressure — promote it into the gating set" : "fell back"}\n${detail}`,
    );
    expect(
      passed,
      `"${fallbackCase.name}" fell back — expected a weaver ${command} command.\n${detail}`,
    ).toBe(true);
  });
});
