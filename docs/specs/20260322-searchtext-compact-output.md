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

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed:
      - Feature doc updated (`docs/features/searchText.md` if it exists, or the relevant feature doc)
      - handoff.md current-state section (if layout changed)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
