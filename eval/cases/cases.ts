import { GATING_MODELS } from "../harness/config.js";
import type { SkillName } from "../harness/context.js";
import { loadFixture } from "../harness/fixtures.js";

/** Which turn of the run a case's op is expected to surface at. */
export type Exposure = "progressive" | "front-loaded";

/**
 * Marks a case as tracking a known-weak model reflex rather than gating the
 * run on the models it names: its rate is still measured and printed, but
 * never fails the case there. On every other roster model the case gates
 * normally. `since` (`YYYY-MM-DD`) and `reason` (`"<reflex> — <rate> at
 * demotion"`) keep the marking dated and re-checkable at a later full run,
 * rather than a standing excuse nobody revisits.
 */
export interface ObservationalMarker {
  since: string;
  reason: string;
  /** Roster model ids (see {@link GATING_MODELS}) this demotion applies to. */
  models: readonly string[];
}

interface CaseBase {
  name: string;
  task: string;
  /**
   * Turns of true-shell momentum the harness prepends before the task (see
   * `buildHabitMomentumSeed`). Absent defaults to `1`; `WEAVER_EVAL_CLEAN`
   * drops it to `0` regardless of this value.
   */
  momentumTurns?: number;
  /**
   * Overrides the canned result fed back for specific tool calls this case's
   * run makes, keyed by weaver subcommand (e.g. "search-text") or tool name
   * (e.g. "bash"). Absent keys fall through to the harness's global
   * defaults — see `cannedToolResult` in `eval/harness/agentic-loop.ts`.
   */
  cannedResults?: Record<string, string>;
  observational?: ObservationalMarker;
}

/**
 * The model must reach for the named skill (rather than the shell directly)
 * and land on the right weaver command with the right args.
 */
export interface ProgressiveOpCase extends CaseBase {
  exposure: "progressive";
  expect: {
    skill: SkillName;
    command: string;
    keyArgs?: Record<string, unknown>;
  };
}

/**
 * Legitimate shell/Edit work that must stay in `bash` — guards against a
 * skill description over-triggering and stealing a task no skill should
 * claim. Judged all-clean by default; an observational marker demotes that
 * judgement on the models it names, so a known over-trigger is still
 * measured and printed but does not fail the case there.
 */
export interface BoundaryCase extends CaseBase {
  exposure: "progressive";
  expect: {
    skill: "bash";
  };
}

/**
 * The full skill body is already in context; the model only has to emit the
 * right weaver command with the right args.
 */
export interface FrontLoadedCase extends CaseBase {
  exposure: "front-loaded";
  expect: {
    command: string;
    keyArgs?: Record<string, unknown>;
  };
  /**
   * A pre-seeded step-1 tool result — this case's own prior turn (e.g. a
   * `search-text` or `cat` the model already "ran"). Distinct from the
   * harness's habit-momentum seed built by `seedForCase`/`buildHabitMomentumSeed`,
   * which is weaver-orthogonal shell noise, not part of the task itself.
   * `step1Command` is the realistic command the assistant "ran" (a `weaver`
   * op, or a plain shell read like `cat`); `fixture` is the fixture filename
   * (extension included) whose content is fed back as the step-1 tool result.
   */
  seed?: { step1Command: string; fixture: string };
}

export type CaseEntry = ProgressiveOpCase | BoundaryCase | FrontLoadedCase;
/** Either op-case variant — the ones judged on a rate rather than all-clean. */
export type OpCase = ProgressiveOpCase | FrontLoadedCase;

export function isProgressiveOpCase(entry: CaseEntry): entry is ProgressiveOpCase {
  return entry.exposure === "progressive" && entry.expect.skill !== "bash";
}

export function isBoundaryCase(entry: CaseEntry): entry is BoundaryCase {
  // The exposure check is redundant with BoundaryCase's own type (exposure is
  // always "progressive" there) — expect.skill === "bash" only exists on that
  // variant, so no well-typed entry can hit skill === "bash" with a different
  // exposure. Its mutant (dropping the left operand) is an accepted,
  // behaviourally equivalent survivor.
  return entry.exposure === "progressive" && entry.expect.skill === "bash";
}

export function isFrontLoadedCase(entry: CaseEntry): entry is FrontLoadedCase {
  return entry.exposure === "front-loaded";
}

/** Either op-case variant — the ones the gate lane runs through the escalating rate gate. */
export function isOpCase(entry: CaseEntry): entry is OpCase {
  return !isBoundaryCase(entry);
}

const OBSERVATIONAL_SINCE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GATING_MODEL_IDS = new Set(GATING_MODELS.map((model) => model.id));

function validateObservational(entry: CaseEntry): void {
  const marker = entry.observational;
  if (!marker) return;
  if (!OBSERVATIONAL_SINCE_PATTERN.test(marker.since)) {
    throw new Error(
      `Case "${entry.name}" observational.since must be "YYYY-MM-DD", got "${marker.since}"`,
    );
  }
  if (marker.reason.trim() === "") {
    throw new Error(`Case "${entry.name}" observational.reason must not be empty`);
  }
  if (marker.models.length === 0) {
    throw new Error(`Case "${entry.name}" observational.models must not be empty`);
  }
  const unknownIds = marker.models.filter((id) => !GATING_MODEL_IDS.has(id));
  if (unknownIds.length > 0) {
    throw new Error(
      `Case "${entry.name}" observational.models names unknown model id(s): ${unknownIds.join(", ")}`,
    );
  }
}

/** Eagerly validates all seed fixtures and observational markings at module load. */
export function validateCases(entries: CaseEntry[]): CaseEntry[] {
  for (const entry of entries) {
    if (isFrontLoadedCase(entry) && entry.seed) {
      loadFixture(entry.seed.fixture);
    }
    validateObservational(entry);
  }
  return entries;
}

export const CASES: CaseEntry[] = validateCases([
  // ── Progressive cases ────────────────────────────────────────────────────
  // Each case tests that the model reaches for a skill rather than calling
  // bash directly. At least one case per skill; sed/grep-tempting cases
  // provide signal on whether trigger descriptions are strong enough.

  {
    name: "trigger-refactor-rename",
    exposure: "progressive",
    task: "`userId` is at line 12, column 8 of /tmp/weaver-eval/src/auth.ts — rename it to `accountId` everywhere in the project.",
    expect: { skill: "weaver-refactor", command: "rename", keyArgs: { newName: "accountId" } },
  },
  {
    name: "trigger-refactor-rename-no-coords-sed-tempting",
    exposure: "progressive",
    task: "Rename the variable `userId` to `accountId` across all TypeScript files in /tmp/weaver-eval/src. I don't have the line numbers.",
    expect: { skill: "weaver-refactor", command: "rename", keyArgs: { newName: "accountId" } },
    // A rename without coordinates needs a search precursor to locate `userId`
    // before it can act; the focused fixture hands back only that position, so
    // the case measures whether the model converges on the rename rather than
    // stalling on a harness that never carries a position back.
    cannedResults: { "search-text": loadFixture("searchText-userId.json") },
  },
  {
    name: "trigger-refactor-move-file",
    exposure: "progressive",
    task: "Move /tmp/weaver-eval/src/auth.ts to /tmp/weaver-eval/src/authentication/auth.ts and update all imports.",
    expect: {
      skill: "weaver-refactor",
      command: "move-file",
      keyArgs: { oldPath: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "trigger-search-and-replace-pattern",
    exposure: "progressive",
    task: 'Replace all occurrences of "v1" with "v2" across the project, including in comments.',
    expect: {
      skill: "weaver-search-and-replace",
      command: "replace-text",
      keyArgs: { replacement: "v2" },
    },
    // A replace often searches first to confirm the pattern exists; the focused
    // fixture hands back real `v1` hits so the precursor doesn't read as
    // "nothing to replace" and strand the model short of `replace-text`.
    cannedResults: { "search-text": loadFixture("searchText-v1.json") },
  },
  {
    name: "trigger-search-and-replace-todos-grep-tempting",
    exposure: "progressive",
    task: "Find all the TODO comments in /tmp/weaver-eval/src — I need the file, line number, and context around each one.",
    expect: {
      skill: "weaver-search-and-replace",
      command: "search-text",
      keyArgs: { pattern: "TODO" },
    },
  },
  {
    name: "trigger-search-and-replace-sed-tempting",
    exposure: "progressive",
    task: 'Replace every occurrence of the string "v1" with "v2" in all TypeScript source files under /tmp/weaver-eval/src. Make sure to get comments too.',
    expect: {
      skill: "weaver-search-and-replace",
      command: "replace-text",
      keyArgs: { replacement: "v2" },
    },
    cannedResults: { "search-text": loadFixture("searchText-v1.json") },
  },
  {
    name: "trigger-code-inspection-find-references",
    exposure: "progressive",
    task: "Where is `authenticate` used? It's at line 5, column 17 of /tmp/weaver-eval/src/auth.ts.",
    expect: {
      skill: "weaver-code-inspection",
      command: "find-references",
      keyArgs: { file: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "trigger-code-inspection-find-references-delete-intent",
    exposure: "progressive",
    task: "I want to delete `parseToken` — it's at line 10, column 17 of /tmp/weaver-eval/src/auth.ts. What's using it before I remove it?",
    expect: {
      skill: "weaver-code-inspection",
      command: "find-references",
      keyArgs: { file: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "trigger-code-inspection-get-type-errors",
    exposure: "progressive",
    task: "Are there any TypeScript errors in /tmp/weaver-eval/src/auth.ts? I want to check before I start refactoring.",
    expect: { skill: "weaver-code-inspection", command: "get-type-errors" },
  },

  // ── Pressured buried cases (deep-pressure gating rung) ─────────────────────
  // The op request is embedded inside a broader, multi-part task rather than
  // stated directly, and the case seeds a three-turn true-shell momentum trail
  // before the task. These gate on the `belowAlarm` floor like any trigger case
  // — a spike (n≥6) confirmed each converges under this deeper pressure, so the
  // rung discriminates rather than sampling noise (see docs/eval-baselines.md).
  // Coords co-vary with the mechanism: a read-only target gets coordinates where
  // the op needs them and manufactures no precursor; a mutating target withholds
  // them and owns a search precursor fixture to reproduce the precursor-stall
  // path.

  // A repo-wide bump stated as intent with no action push (the declarative form
  // is the harder discriminator — whether the model still converts to the
  // mutating op without an imperative). Owns a search precursor fixture so a
  // search-then-replace trajectory has real hits to act on.
  {
    name: "pressured-buried-replace-text-passive",
    exposure: "progressive",
    task: "We're doing a version bump across the repo: replace every `v1` with `v2`, comments included.",
    momentumTurns: 3,
    expect: {
      skill: "weaver-search-and-replace",
      command: "replace-text",
      keyArgs: { replacement: "v2" },
    },
    cannedResults: { "search-text": loadFixture("searchText-v1-repo.json") },
  },
  {
    name: "pressured-buried-find-references",
    exposure: "progressive",
    task: "I'm prepping the auth module for release: skim the recent commits, then find everything using `authenticate` at line 5, column 17 of /tmp/weaver-eval/src/auth.ts, and note anything odd in the changelog.",
    momentumTurns: 3,
    expect: {
      skill: "weaver-code-inspection",
      command: "find-references",
      keyArgs: { file: "/tmp/weaver-eval/src/auth.ts" },
    },
  },

  // ── Boundary cases (over-trigger guard) ─────────────────────────────────────
  // Legitimate shell/Edit work that must stay in `bash`, guarding against an
  // over-broad description stealing a task no skill should claim. Each is an
  // adjacent negative on a description's decision boundary; see
  // docs/eval-design.md for why tasks far from any description aren't included.

  {
    name: "boundary-bash-remove-console-log",
    exposure: "progressive",
    task: "Remove the leftover `console.log('debug')` on line 15 of /tmp/weaver-eval/src/app.ts.",
    expect: { skill: "bash" },
    observational: {
      since: "2026-08-08",
      reason: "over-triggers into a weaver call for a plain single-line edit — 0/10 at demotion",
      models: ["openai/gpt-5.6-luna"],
    },
  },

  // ── Front-loaded cases ───────────────────────────────────────────────────
  // Each case tests that the model emits the correct `weaver <subcommand>` call
  // with the right key arguments. The full skill content is in context.

  {
    name: "command-rename",
    exposure: "front-loaded",
    momentumTurns: 3,
    task: "`userId` is at line 12, column 8 of /tmp/weaver-eval/src/auth.ts — rename it to `accountId` everywhere in the project.",
    expect: {
      command: "rename",
      keyArgs: { newName: "accountId" },
    },
  },
  {
    name: "command-move-file",
    exposure: "front-loaded",
    momentumTurns: 3,
    task: "Move /tmp/weaver-eval/src/auth.ts to /tmp/weaver-eval/src/authentication/auth.ts.",
    expect: {
      command: "move-file",
      keyArgs: { oldPath: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "command-move-directory",
    exposure: "front-loaded",
    momentumTurns: 3,
    task: "Move the /tmp/weaver-eval/src/utils directory to /tmp/weaver-eval/src/lib/helpers.",
    expect: {
      command: "move-directory",
      keyArgs: { oldPath: "/tmp/weaver-eval/src/utils" },
    },
  },
  {
    name: "command-move-symbol",
    exposure: "front-loaded",
    momentumTurns: 3,
    task: "Move the exported function `parseToken` from /tmp/weaver-eval/src/auth.ts to /tmp/weaver-eval/src/utils/token.ts.",
    expect: {
      command: "move-symbol",
      keyArgs: { symbolName: "parseToken" },
    },
  },
  {
    name: "command-find-importers",
    exposure: "front-loaded",
    momentumTurns: 3,
    task: "Which files import /tmp/weaver-eval/src/auth.ts?",
    expect: {
      command: "find-importers",
      keyArgs: { file: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "command-find-references",
    exposure: "front-loaded",
    momentumTurns: 3,
    task: "Find all references to the symbol `authenticate` at line 5, column 17 of /tmp/weaver-eval/src/auth.ts.",
    expect: {
      command: "find-references",
      keyArgs: { file: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "command-get-definition",
    exposure: "front-loaded",
    momentumTurns: 3,
    task: "Where is `User` actually defined? I'm looking at line 8, column 12 of /tmp/weaver-eval/src/api.ts.",
    expect: {
      command: "get-definition",
      keyArgs: { file: "/tmp/weaver-eval/src/api.ts" },
    },
  },
  // Haiku's single most-habituated check-for-errors reflex is `npx tsc`, not
  // `weaver get-type-errors` — a decision-path router with an explicit
  // "Never: tsc/npx tsc" row still doesn't hold it under momentum, unlike the
  // sibling reflexes (search-text, find-importers, move-directory) the same
  // router style did hold. See docs/eval-baselines.md for the measured rate.
  {
    name: "command-get-type-errors",
    exposure: "front-loaded",
    momentumTurns: 3,
    task: "Are there any TypeScript errors in /tmp/weaver-eval/src/auth.ts?",
    expect: {
      command: "get-type-errors",
    },
    observational: {
      since: "2026-07-24",
      reason: "tsc reflex — 3/5 at demotion",
      models: ["anthropic/claude-haiku-4.5"],
    },
  },
  {
    name: "command-search-text",
    exposure: "front-loaded",
    momentumTurns: 3,
    task: "Find all TODO comments in /tmp/weaver-eval/src — file, line, and surrounding context.",
    expect: {
      command: "search-text",
      keyArgs: { pattern: "TODO" },
    },
  },
  {
    name: "command-delete-file",
    exposure: "front-loaded",
    momentumTurns: 3,
    task: "Delete /tmp/weaver-eval/src/old-helper.ts and clean up all its imports.",
    expect: {
      command: "delete-file",
      keyArgs: { file: "/tmp/weaver-eval/src/old-helper.ts" },
    },
  },
  {
    name: "command-replace-text",
    exposure: "front-loaded",
    momentumTurns: 3,
    task: 'Replace every occurrence of "v1" with "v2" across all TypeScript files in the project.',
    expect: {
      command: "replace-text",
      keyArgs: { replacement: "v2" },
    },
  },

  // ── Two-step flows ────────────────────────────────────────────────────────
  // Pre-seeded with step-1 conversation (user task + assistant tool_use +
  // tool_result from canned fixture). Assert the follow-up command.

  {
    name: "two-step-search-then-rename",
    exposure: "front-loaded",
    task: "Rename `userId` to `accountId` everywhere in the project. It's in /tmp/weaver-eval/src/auth.ts but I don't have the line number.",
    seed: {
      step1Command: `weaver search-text '{"pattern":"userId"}'`,
      fixture: "searchText-userId.json",
    },
    expect: {
      command: "rename",
      keyArgs: { file: "/tmp/weaver-eval/src/auth.ts", line: 12, col: 9, newName: "accountId" },
    },
  },
  {
    // The task gives the line range, but the model reads the file first; the
    // seed carries that `cat` so the asserted follow-up is the extract itself.
    name: "two-step-cat-then-extract",
    exposure: "front-loaded",
    task: "Extract lines 10–20 of /tmp/weaver-eval/src/auth.ts into a new function called `hashPassword`.",
    seed: {
      step1Command: "cat /tmp/weaver-eval/src/auth.ts",
      fixture: "sources/auth.ts",
    },
    expect: {
      command: "extract-function",
      keyArgs: { functionName: "hashPassword" },
    },
  },
]);
