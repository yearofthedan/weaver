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
  "find-references": "read-only",
  "find-importers": "read-only",
  "get-definition": "read-only",
  "get-type-errors": "read-only",
  "search-text": "read-only",
};
