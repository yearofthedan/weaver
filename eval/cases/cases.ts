import type { SkillName } from "../harness/context.js";
import { loadFixture } from "../harness/fixtures.js";

export interface CaseEntry {
  name: string;
  stage: "trigger" | "command";
  task: string;
  /**
   * A two-step case's seeded step-1 result. `step1Command` is the realistic
   * command the assistant "ran" (a `weaver` op, or a plain shell read like
   * `cat`); `fixture` is the fixture filename (extension included) whose content
   * is fed back as the step-1 tool result.
   */
  seed?: { step1Command: string; fixture: string };
  expect: {
    /**
     * The expected first tool selection at the trigger stage: a skill name, or
     * "bash" for boundary cases that must stay in the shell (guards against a
     * description over-triggering and stealing legitimate shell work).
     */
    skill?: SkillName | "bash";
    command?: string;
    keyArgs?: Record<string, unknown>;
  };
  /**
   * Overrides the canned result fed back for specific tool calls the agentic
   * lane makes during this case, keyed by weaver subcommand (e.g.
   * "search-text") or tool name (e.g. "bash"). Absent keys fall through to
   * the harness's global defaults — see `cannedToolResult` in
   * `eval/harness/agentic-loop.ts`. Empty/absent is the common case; only a
   * multi-hop scenario that needs a realistic intermediate result sets this.
   */
  cannedResults?: Record<string, string>;
  /**
   * Turns of true-shell momentum the agentic trigger lane prepends before
   * the task (see `buildHabitMomentumSeed`). Absent defaults to `1`. Only
   * the agentic trigger lane reads this field.
   */
  momentumTurns?: number;
  /**
   * When true, the agentic trigger lane reports this case's rate + trail
   * but does not gate on the `belowAlarm` floor. Absent defaults to
   * `false` (gating). Only meaningful on `stage: "trigger"` skill cases.
   */
  observational?: boolean;
}

/** Eagerly validates all seed operations at module load. */
function validateCases(entries: CaseEntry[]): CaseEntry[] {
  for (const entry of entries) {
    if (entry.seed) {
      loadFixture(entry.seed.fixture);
    }
  }
  return entries;
}

export const CASES: CaseEntry[] = validateCases([
  // ── Trigger-stage cases ───────────────────────────────────────────────────
  // Each case tests that the model reaches for a skill rather than calling
  // bash directly. At least one case per skill; sed/grep-tempting cases
  // provide signal on whether trigger descriptions are strong enough.

  {
    name: "trigger-refactor-rename",
    stage: "trigger",
    task: "`userId` is at line 12, column 8 of /tmp/weaver-eval/src/auth.ts — rename it to `accountId` everywhere in the project.",
    expect: { skill: "weaver-refactor", command: "rename", keyArgs: { newName: "accountId" } },
  },
  {
    name: "trigger-refactor-rename-no-coords-sed-tempting",
    stage: "trigger",
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
    stage: "trigger",
    task: "Move /tmp/weaver-eval/src/auth.ts to /tmp/weaver-eval/src/authentication/auth.ts and update all imports.",
    expect: {
      skill: "weaver-refactor",
      command: "move-file",
      keyArgs: { oldPath: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "trigger-search-and-replace-pattern",
    stage: "trigger",
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
    stage: "trigger",
    task: "Find all the TODO comments in /tmp/weaver-eval/src — I need the file, line number, and context around each one.",
    expect: {
      skill: "weaver-search-and-replace",
      command: "search-text",
      keyArgs: { pattern: "TODO" },
    },
  },
  {
    name: "trigger-search-and-replace-sed-tempting",
    stage: "trigger",
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
    stage: "trigger",
    task: "Where is `authenticate` used? It's at line 5, column 17 of /tmp/weaver-eval/src/auth.ts.",
    expect: {
      skill: "weaver-code-inspection",
      command: "find-references",
      keyArgs: { file: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "trigger-code-inspection-find-references-delete-intent",
    stage: "trigger",
    task: "I want to delete `parseToken` — it's at line 10, column 17 of /tmp/weaver-eval/src/auth.ts. What's using it before I remove it?",
    expect: {
      skill: "weaver-code-inspection",
      command: "find-references",
      keyArgs: { file: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "trigger-code-inspection-get-type-errors",
    stage: "trigger",
    task: "Are there any TypeScript errors in /tmp/weaver-eval/src/auth.ts? I want to check before I start refactoring.",
    expect: { skill: "weaver-code-inspection", command: "get-type-errors" },
  },

  // ── Pressured buried cases (observational discrimination rung) ─────────────
  // The op request is embedded inside a broader, multi-part task rather than
  // stated directly, and the case seeds a three-turn true-shell momentum trail
  // before the task. These report rate + trail but do not gate (observational:
  // true) — see docs/eval-design.md, "Don't tier what n=3 can't resolve".
  // Coords co-vary with the mechanism: the mutating targets (rename,
  // replace-text) withhold coordinates and own a search precursor fixture to
  // reproduce the precursor-stall path; the read-only targets (search-text,
  // find-references) get coordinates where the op needs them and manufacture
  // no precursor.

  {
    name: "pressured-buried-rename",
    stage: "trigger",
    task: "I'm cleaning up the auth module before the release: check what's currently exported from it, then rename `userId` to `accountId` across the project since we've standardized on the new naming, and note anything else that looks inconsistent while you're in there.",
    momentumTurns: 3,
    observational: true,
    expect: { skill: "weaver-refactor", command: "rename", keyArgs: { newName: "accountId" } },
    cannedResults: { "search-text": loadFixture("searchText-userId.json") },
  },
  {
    name: "pressured-buried-replace-text",
    stage: "trigger",
    task: "We're doing a version bump across the repo: replace every `v1` with `v2` including comments throughout the project, and flag any file where the replacement looks risky.",
    momentumTurns: 3,
    observational: true,
    expect: {
      skill: "weaver-search-and-replace",
      command: "replace-text",
      keyArgs: { replacement: "v2" },
    },
    cannedResults: { "search-text": loadFixture("searchText-v1.json") },
  },
  {
    name: "pressured-buried-search-text",
    stage: "trigger",
    task: "I'm doing a cleanup pass before the sprint review: check the recent commits for context, then find all the TODO comments in the project with file, line number, and surrounding context, and summarize how many there are.",
    momentumTurns: 3,
    observational: true,
    expect: {
      skill: "weaver-search-and-replace",
      command: "search-text",
      keyArgs: { pattern: "TODO" },
    },
  },
  {
    name: "pressured-buried-find-references",
    stage: "trigger",
    task: "I'm prepping the auth module for release: skim the recent commits, then find everything using `authenticate` at line 5, column 17 of /tmp/weaver-eval/src/auth.ts, and note anything odd in the changelog.",
    momentumTurns: 3,
    observational: true,
    expect: {
      skill: "weaver-code-inspection",
      command: "find-references",
      keyArgs: { file: "/tmp/weaver-eval/src/auth.ts" },
    },
  },

  // ── Boundary cases (over-trigger guard) ─────────────────────────────────────
  // Legitimate shell/Edit work that must stay in `bash`, guarding against an
  // over-broad description stealing a task no skill should claim. Both are
  // adjacent negatives on a description's decision boundary; see
  // docs/eval-design.md for why tasks far from any description aren't included.

  {
    name: "boundary-bash-search-non-ts-project",
    stage: "trigger",
    task: "Search for `API_KEY` across the Python files in /tmp/weaver-eval-py.",
    expect: { skill: "bash" },
  },
  {
    name: "boundary-bash-remove-console-log",
    stage: "trigger",
    task: "Remove the leftover `console.log('debug')` on line 15 of /tmp/weaver-eval/src/app.ts.",
    expect: { skill: "bash" },
  },

  // ── Command-stage cases ───────────────────────────────────────────────────
  // Each case tests that the model emits the correct `weaver <subcommand>` call
  // with the right key arguments. The full skill content is in context.

  {
    name: "command-rename",
    stage: "command",
    task: "`userId` is at line 12, column 8 of /tmp/weaver-eval/src/auth.ts — rename it to `accountId` everywhere in the project.",
    expect: {
      command: "rename",
      keyArgs: { newName: "accountId" },
    },
  },
  {
    name: "command-move-file",
    stage: "command",
    task: "Move /tmp/weaver-eval/src/auth.ts to /tmp/weaver-eval/src/authentication/auth.ts.",
    expect: {
      command: "move-file",
      keyArgs: { oldPath: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "command-move-directory",
    stage: "command",
    task: "Move the /tmp/weaver-eval/src/utils directory to /tmp/weaver-eval/src/lib/helpers.",
    expect: {
      command: "move-directory",
      keyArgs: { oldPath: "/tmp/weaver-eval/src/utils" },
    },
  },
  {
    name: "command-move-symbol",
    stage: "command",
    task: "Move the exported function `parseToken` from /tmp/weaver-eval/src/auth.ts to /tmp/weaver-eval/src/utils/token.ts.",
    expect: {
      command: "move-symbol",
      keyArgs: { symbolName: "parseToken" },
    },
  },
  {
    name: "command-find-importers",
    stage: "command",
    task: "Which files import /tmp/weaver-eval/src/auth.ts?",
    expect: {
      command: "find-importers",
      keyArgs: { file: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "command-find-references",
    stage: "command",
    task: "Find all references to the symbol `authenticate` at line 5, column 17 of /tmp/weaver-eval/src/auth.ts.",
    expect: {
      command: "find-references",
      keyArgs: { file: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "command-get-definition",
    stage: "command",
    task: "Where is `User` actually defined? I'm looking at line 8, column 12 of /tmp/weaver-eval/src/api.ts.",
    expect: {
      command: "get-definition",
      keyArgs: { file: "/tmp/weaver-eval/src/api.ts" },
    },
  },
  {
    name: "command-get-type-errors",
    stage: "command",
    task: "Are there any TypeScript errors in /tmp/weaver-eval/src/auth.ts?",
    expect: {
      command: "get-type-errors",
    },
  },
  {
    name: "command-search-text",
    stage: "command",
    task: "Find all TODO comments in /tmp/weaver-eval/src — file, line, and surrounding context.",
    expect: {
      command: "search-text",
      keyArgs: { pattern: "TODO" },
    },
  },
  {
    name: "command-delete-file",
    stage: "command",
    task: "Delete /tmp/weaver-eval/src/old-helper.ts and clean up all its imports.",
    expect: {
      command: "delete-file",
      keyArgs: { file: "/tmp/weaver-eval/src/old-helper.ts" },
    },
  },
  {
    name: "command-replace-text",
    stage: "command",
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
    stage: "command",
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
    stage: "command",
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
