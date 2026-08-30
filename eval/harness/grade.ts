import { extractBashCommands, weaverSubcommand } from "./assertions.js";
import type { ToolCall } from "./call-model.js";

/**
 * Classifies every weaver CLI subcommand as `"mutating"` (writes to the
 * workspace) or `"read-only"` (inspects it). The completeness-guard test in
 * `grade.test.ts` iterates `OPERATION_NAMES` from the dispatcher's operation
 * registry — the single source of truth — so a new operation added without a
 * classification here fails loud instead of silently falling through the
 * agentic grader.
 */
export type SubcommandMutability = "mutating" | "read-only";

export const SUBCOMMAND_MUTABILITY: Record<string, SubcommandMutability> = {
  rename: "mutating",
  "move-file": "mutating",
  "move-directory": "mutating",
  "move-symbol": "mutating",
  "extract-function": "mutating",
  "replace-text": "mutating",
  "delete-file": "mutating",
  "set-export": "mutating",
  "find-references": "read-only",
  "find-importers": "read-only",
  "get-definition": "read-only",
  "get-type-errors": "read-only",
  "search-text": "read-only",
};

/**
 * True when `call` is a `weaver <sub>` bash invocation whose subcommand is
 * mutating and is not `expectedCommand` — a destructive detour the agentic
 * loop hard-fails on rather than lets the model recover from. A read-only
 * subcommand, the expected command itself, or a non-weaver/non-bash call are
 * all `false` — they are legitimate precursors or unrelated calls, not
 * competitors. `&&`-chains are split the same way the match predicate splits
 * them, so a `cd <dir> && weaver <sub>` chain is inspected on the weaver
 * segment rather than slipping through as a non-weaver command.
 */
export function isMutatingCompetitor(call: ToolCall, expectedCommand: string): boolean {
  return extractBashCommands([call]).some((cmd) => {
    const subcommand = weaverSubcommand(cmd);
    return (
      subcommand !== undefined &&
      subcommand !== expectedCommand &&
      SUBCOMMAND_MUTABILITY[subcommand] === "mutating"
    );
  });
}
