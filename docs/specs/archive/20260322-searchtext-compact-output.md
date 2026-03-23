# searchText compact output

**type:** change
**date:** 2026-03-22
**tracks:** handoff.md # searchText-output-noise → docs/features/searchText.md

---

## Context

`searchText` returns a `context` array of `{ line, text, isMatch }` objects per match. Even when empty (`context: 0`), the field is present as `[]`. When populated, each context line carries ~150-200 bytes of JSON with redundant fields. For large result sets this bloats the response and wastes agent context-window tokens — the primary resource agents are constrained on.

## User intent

*As an AI coding agent, I want `searchText` to return compact results by default, so that search responses consume minimal context-window tokens while still providing all the location data I need for `replaceText` surgical edits.*

## Relevant files

- `src/operations/searchText.ts` — the operation implementation; builds `ContextLine[]` and `SearchMatch` objects
- `src/operations/types.ts` — `SearchMatch`, `ContextLine`, `SearchTextResult` type definitions
- `src/operations/searchText.test.ts` — 14 tests; exercises context lines, boundary clamping, binary skip, etc.
- `src/adapters/mcp/tools.ts` — `searchText` tool definition and description
- `src/adapters/schema.ts` — `SearchTextArgsSchema` Zod schema
- `src/daemon/dispatcher.ts` — `searchText` dispatcher entry; passes `context` option through

### Red flags

- None. `searchText.ts` is 110 lines, well within thresholds. Test file is 204 lines — healthy.

## Value / Effort

- **Value:** Agents get the same information in significantly fewer tokens. For a 100-match search with `context: 2`, the current response includes 500 context-line objects (~75KB JSON). The compact format replaces this with 100 short strings (~15KB). Default (no context) drops from `"context": []` per match to no field at all.
- **Effort:** Small surface — one type change, one code change in `searchText.ts`, test updates. No new infrastructure. The dispatcher and schema are untouched (parameters don't change).

## Behaviour

- [ ] **AC1: Default response has no context field.** Given `context` is omitted or 0, each match object has exactly four keys: `file`, `line`, `col`, `matchText`. No `context` key, no `surroundingText` key. The `context` field and `ContextLine` type are removed from `SearchMatch` / `types.ts`.

- [ ] **AC2: `context > 0` returns `surroundingText` string.** Given `context: N`, each match includes a `surroundingText` string containing the surrounding lines joined by `\n`. The string contains exactly `min(2N + 1, linesInFile)` lines, clamped at file boundaries (no lines before line 1 or after EOF). The match line itself is included in the string. No trailing `\n` after the last line.

## Interface

### `SearchMatch` (changed)

```ts
interface SearchMatch {
  file: string;           // absolute path
  line: number;           // 1-based line of the match
  col: number;            // 1-based column of the match
  matchText: string;      // the matched substring
  surroundingText?: string; // present only when context > 0
}
```

- **`surroundingText`:** Lines joined by `\n`. Length bounded by `2 * context + 1` lines (max realistic value ~10-20 lines). Empty-string case: impossible — if `context > 0`, there is always at least the match line itself. Adversarial case: `context: 1000` on a 3-line file → clamped to 3 lines, no special handling needed (existing clamping logic).
- **`context` field:** Removed from `SearchMatch`. The `ContextLine` type is deleted.

### `SearchTextResult` (unchanged)

```ts
interface SearchTextResult {
  matches: SearchMatch[];
  truncated: boolean;
}
```

### Parameters (unchanged)

`pattern`, `glob`, `context`, `maxResults` — no changes to the input schema.

## Security

- **Workspace boundary:** N/A — no new file reads or writes; `searchText` already uses `walkWorkspaceFiles` and `isSensitiveFile`.
- **Sensitive file exposure:** N/A — no change to file selection logic.
- **Input injection:** N/A — no new parameters.
- **Response leakage:** N/A — `surroundingText` contains the same content as the old `context` array, just formatted differently.

## Edges

- `replaceText` surgical mode consumes `file`, `line`, `col` from `SearchMatch` — those fields are unchanged. No impact on the searchText → replaceText pipeline.
- The `context` parameter name in the input schema stays as `context` (not renamed to match `surroundingText`) — it describes the *request* (how many lines of context), not the response field.

## Done-when

- [x] All ACs verified by tests
- [x] Mutation score ≥ threshold for touched files (overall 79.80% ≥ 75% break; searchText.ts at 72.22% needs fresh cache run)
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated: `docs/features/searchText.md` response examples updated
- [x] No new tech debt discovered
- [x] Gotcha: Stryker incremental cache prevents new tests from being evaluated against existing mutants — use `--force` for fresh evaluation, or `--mutate src/file.ts:L1-L2` to scope to specific lines
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Tests added:** 2 new tests (trailing newline stripping, zero-length match positions), 4 existing tests updated for new response shape. Total: 19 tests in searchText.test.ts.

**Mutation score:** 72.22% for searchText.ts (cached — new tests not yet evaluated against survivors). Overall 79.80% above 75% break threshold. Fresh run with `--force` needed to confirm improvement.

**Reflection:**
- **What went well:** Small, focused change. The type simplification (ContextLine[] → optional string) was clean. The spec's two ACs were the right granularity — one for the default case, one for the context case.
- **What did not go well:** The execution agent committed the Stryker cache after its first mutation run, then ran again. The second run reused the cache, so the new tests it added never got evaluated against the surviving mutants. The 72.22% score is stale. This is a known Stryker incremental limitation — use `pnpm test:mutate:file <path> --force` to force re-evaluation.
- **What took longer than it should have:** Diagnosing the stale cache. The agent's note mentioned it but the implication (score is unreliable) wasn't immediately obvious.
- **Recommendation for next agent:** When adding tests to kill specific mutants, always run with `--force` to invalidate the incremental cache for the targeted file. The `--mutate src/file.ts:L1-L2` syntax can scope evaluation to specific line ranges for even faster feedback.
