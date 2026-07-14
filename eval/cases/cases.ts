import type { SkillName } from "../harness/context.js";
import { loadFixture } from "../harness/fixtures.js";

export interface CaseEntry {
  name: string;
  stage: "trigger" | "command";
  task: string;
  /**
   * A two-step case's seeded step-1 result. `step1Command` is the realistic
   * weaver command the assistant "ran"; `fixture` is the fixture name whose
   * JSON is fed back as the step-1 tool result.
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
    cannedResults: { "search-text": loadFixture("searchText-userId") },
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
    cannedResults: { "search-text": loadFixture("searchText-v1") },
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
    cannedResults: { "search-text": loadFixture("searchText-v1") },
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

  // ── Boundary cases ────────────────────────────────────────────────────────
  // The inverse of the tempting cases: legitimate shell work that must stay in
  // `bash`. They guard against an aggressive description (e.g. "use instead of
  // grep") over-triggering and stealing tasks no skill should claim.

  {
    name: "boundary-bash-list-files",
    stage: "trigger",
    task: "List the files in /tmp/weaver-eval/src.",
    expect: { skill: "bash" },
  },
  {
    name: "boundary-bash-run-tests",
    stage: "trigger",
    task: "Run the test suite in /tmp/weaver-eval.",
    expect: { skill: "bash" },
  },
  {
    name: "boundary-bash-tail-log",
    stage: "trigger",
    task: "Show me the last 30 lines of /tmp/weaver-eval/build.log.",
    expect: { skill: "bash" },
  },
  {
    name: "boundary-bash-count-lines",
    stage: "trigger",
    task: "How many lines are in /tmp/weaver-eval/src/auth.ts?",
    expect: { skill: "bash" },
  },
  {
    name: "boundary-bash-mkdir",
    stage: "trigger",
    task: "Make a new directory /tmp/weaver-eval/src/generated.",
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
    name: "command-extract-function",
    stage: "command",
    task: "Extract lines 10–20 of /tmp/weaver-eval/src/auth.ts into a new function called `hashPassword`.",
    expect: {
      command: "extract-function",
      keyArgs: { functionName: "hashPassword" },
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
      fixture: "searchText-userId",
    },
    expect: {
      command: "rename",
      keyArgs: { file: "/tmp/weaver-eval/src/auth.ts", line: 12, col: 9, newName: "accountId" },
    },
  },
]);
