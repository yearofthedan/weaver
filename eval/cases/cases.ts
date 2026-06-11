import * as fs from "node:fs";
import * as path from "node:path";
import type { SkillName } from "../harness/context.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures");

export interface CaseEntry {
  name: string;
  stage: "trigger" | "command";
  task: string;
  seed?: { operation: string };
  expect: {
    skill?: SkillName;
    subcommand?: string;
    keyArgs?: Record<string, unknown>;
  };
}

function fixtureContent(operation: string): string {
  const fixturePath = path.join(FIXTURES_DIR, `${operation}.json`);
  try {
    return fs.readFileSync(fixturePath, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error(
        `Case table references fixture "${operation}" but ${fixturePath} does not exist`,
      );
    }
    throw err;
  }
}

/** camelCase operation name → kebab-case CLI subcommand, matching src/adapters/cli/operations.ts */
export function operationToSubcommand(operation: string): string {
  return operation.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`);
}

/** Eagerly validates all seed operations at module load. */
function validateCases(entries: CaseEntry[]): CaseEntry[] {
  for (const entry of entries) {
    if (entry.seed) {
      fixtureContent(entry.seed.operation);
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
    expect: { skill: "weaver-refactor" },
  },
  {
    name: "trigger-refactor-rename-no-coords-sed-tempting",
    stage: "trigger",
    task: "Rename the variable `userId` to `accountId` across all TypeScript files in /tmp/weaver-eval/src. I don't have the line numbers.",
    expect: { skill: "weaver-refactor" },
  },
  {
    name: "trigger-refactor-move-file",
    stage: "trigger",
    task: "Move /tmp/weaver-eval/src/auth.ts to /tmp/weaver-eval/src/authentication/auth.ts and update all imports.",
    expect: { skill: "weaver-refactor" },
  },
  {
    name: "trigger-search-and-replace-pattern",
    stage: "trigger",
    task: 'Replace all occurrences of "v1" with "v2" across the project, including in comments.',
    expect: { skill: "weaver-search-and-replace" },
  },
  {
    name: "trigger-search-and-replace-todos-grep-tempting",
    stage: "trigger",
    task: "Find all the TODO comments in /tmp/weaver-eval/src — I need the file, line number, and context around each one.",
    expect: { skill: "weaver-search-and-replace" },
  },
  {
    name: "trigger-search-and-replace-sed-tempting",
    stage: "trigger",
    task: 'Replace every occurrence of the string "v1" with "v2" in all TypeScript source files under /tmp/weaver-eval/src. Make sure to get comments too.',
    expect: { skill: "weaver-search-and-replace" },
  },
  {
    name: "trigger-code-inspection-find-references",
    stage: "trigger",
    task: "Where is `authenticate` used? It's at line 5, column 17 of /tmp/weaver-eval/src/auth.ts.",
    expect: { skill: "weaver-code-inspection" },
  },
  {
    name: "trigger-code-inspection-find-references-delete-intent",
    stage: "trigger",
    task: "I want to delete `parseToken` — it's at line 10, column 17 of /tmp/weaver-eval/src/auth.ts. What's using it before I remove it?",
    expect: { skill: "weaver-code-inspection" },
  },
  {
    name: "trigger-code-inspection-get-type-errors",
    stage: "trigger",
    task: "Are there any TypeScript errors in /tmp/weaver-eval/src/auth.ts? I want to check before I start refactoring.",
    expect: { skill: "weaver-code-inspection" },
  },

  // ── Command-stage cases ───────────────────────────────────────────────────
  // Each case tests that the model emits the correct `weaver <subcommand>` call
  // with the right key arguments. The full skill content is in context.

  {
    name: "command-rename",
    stage: "command",
    task: "`userId` is at line 12, column 8 of /tmp/weaver-eval/src/auth.ts — rename it to `accountId` everywhere in the project.",
    expect: {
      subcommand: "rename",
      keyArgs: { newName: "accountId" },
    },
  },
  {
    name: "command-move-file",
    stage: "command",
    task: "Move /tmp/weaver-eval/src/auth.ts to /tmp/weaver-eval/src/authentication/auth.ts.",
    expect: {
      subcommand: "move-file",
      keyArgs: { oldPath: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "command-move-directory",
    stage: "command",
    task: "Move the /tmp/weaver-eval/src/utils directory to /tmp/weaver-eval/src/lib/helpers.",
    expect: {
      subcommand: "move-directory",
      keyArgs: { oldPath: "/tmp/weaver-eval/src/utils" },
    },
  },
  {
    name: "command-move-symbol",
    stage: "command",
    task: "Move the exported function `parseToken` from /tmp/weaver-eval/src/auth.ts to /tmp/weaver-eval/src/utils/token.ts.",
    expect: {
      subcommand: "move-symbol",
      keyArgs: { symbolName: "parseToken" },
    },
  },
  {
    name: "command-extract-function",
    stage: "command",
    task: "Extract lines 10–20 of /tmp/weaver-eval/src/auth.ts into a new function called `hashPassword`.",
    expect: {
      subcommand: "extract-function",
      keyArgs: { functionName: "hashPassword" },
    },
  },
  {
    name: "command-find-importers",
    stage: "command",
    task: "Which files import /tmp/weaver-eval/src/auth.ts?",
    expect: {
      subcommand: "find-importers",
      keyArgs: { file: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "command-find-references",
    stage: "command",
    task: "Find all references to the symbol `authenticate` at line 5, column 17 of /tmp/weaver-eval/src/auth.ts.",
    expect: {
      subcommand: "find-references",
      keyArgs: { file: "/tmp/weaver-eval/src/auth.ts" },
    },
  },
  {
    name: "command-get-definition",
    stage: "command",
    task: "Where is `User` actually defined? I'm looking at line 8, column 12 of /tmp/weaver-eval/src/api.ts.",
    expect: {
      subcommand: "get-definition",
      keyArgs: { file: "/tmp/weaver-eval/src/api.ts" },
    },
  },
  {
    name: "command-get-type-errors",
    stage: "command",
    task: "Are there any TypeScript errors in /tmp/weaver-eval/src/auth.ts?",
    expect: {
      subcommand: "get-type-errors",
    },
  },
  {
    name: "command-search-text",
    stage: "command",
    task: "Find all TODO comments in /tmp/weaver-eval/src — file, line, and surrounding context.",
    expect: {
      subcommand: "search-text",
      keyArgs: { pattern: "TODO" },
    },
  },
  {
    name: "command-delete-file",
    stage: "command",
    task: "Delete /tmp/weaver-eval/src/old-helper.ts and clean up all its imports.",
    expect: {
      subcommand: "delete-file",
      keyArgs: { file: "/tmp/weaver-eval/src/old-helper.ts" },
    },
  },
  {
    name: "command-replace-text",
    stage: "command",
    task: 'Replace every occurrence of "v1" with "v2" across all TypeScript files in the project.',
    expect: {
      subcommand: "replace-text",
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
    seed: { operation: "searchText" },
    expect: {
      subcommand: "rename",
      keyArgs: { newName: "accountId" },
    },
  },
  {
    name: "two-step-find-references-then-move-symbol",
    stage: "command",
    task: "Move `parseToken` from /tmp/weaver-eval/src/auth.ts to /tmp/weaver-eval/src/utils/token.ts.",
    seed: { operation: "findReferences" },
    expect: {
      subcommand: "move-symbol",
      keyArgs: { symbolName: "parseToken" },
    },
  },
]);

/**
 * Reads the named fixture file and returns its content as a string.
 * Used by the LLM test runner to embed fixture JSON as a tool_result.
 */
export function loadFixture(operation: string): string {
  return fixtureContent(operation);
}
