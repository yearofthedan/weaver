# rename: surface identifiers whose names contain the old symbol

**type:** change
**date:** 2026-04-21
**tracks:** handoff.md # rename-doesnt-catch-derived-variable-names → docs/features/rename.md

---

## Context

`rename` follows the compiler's reference graph. That is the correct definition of "reference" but misses identifiers whose *name* contains the renamed symbol without binding to it — e.g. `tsProviderSingleton` when renaming `TsProvider`. The compiler treats those as independent symbols. During the providers→compilers rename, fixing these name-echoes one at a time cost roughly 100 extra tool calls. A single `replace-text` pass would have handled them, but the agent didn't branch to it. The signal that derived names exist is not surfaced by any tool; the agent has to already know to look for them.

## User intent

*As an agent renaming a top-level TypeScript symbol, I want to see which identifiers in the project still spell the old name after `rename` completes, so that I can decide whether any of them are conventions that should also be updated without hunting for them myself.*

## Relevant files

- `src/operations/types.ts` — `RenameResult` shape; gains an optional `nameMatches` field
- `src/operations/rename.ts` — thin orchestrator; forwards new option to engine
- `src/ts-engine/rename.ts` — `tsRename`; calls the new scan after `applyTextEdits`, before returning
- `src/ts-engine/engine.ts` — `TsMorphEngine.rename` signature picks up the new option
- `src/plugins/vue/engine.ts` — `VolarEngine.rename` signature must match; v1 keeps the field empty for Vue (see Edges)
- `src/adapters/schema.ts` — `RenameArgsSchema` gains `includeNameMatches: z.boolean().optional()`
- `src/adapters/mcp/tools.ts` — tool description gains a line about `nameMatches` and when it fires
- `src/adapters/cli/operations.ts` — CLI rename operation forwards the option
- `docs/features/rename.md` — Constraints / Response sections updated
- `.claude/skills/move-and-rename/SKILL.md` — the "do one `replace-text` pass for derived names" line becomes "review `nameMatches` in the response"

**New file:** `src/ts-engine/name-matches.ts` — pure function `scanNameMatches(project, oldName, excludePositions, limit)` returning `{ count, files, samples, skipped? }`.

### Red flags

- No large test files in the rename family; `src/ts-engine/rename.ts` is 72 lines and `tsRename.test.ts` is 222. Room to grow.
- `RenameResult` is already re-exported from `src/operations/types.ts` and consumed by both MCP and CLI adapters. Adding an optional field is safe; no consumer will break.
- `VolarEngine.rename` (src/plugins/vue/engine.ts) duplicates a chunk of `tsRename`'s logic. v1 keeps them duplicated; scanning inside `.vue` `<script>` blocks is follow-up work (called out in Edges).

**Layer-fit note:**
- AC1 (core scan behaviour) → the scan function is a pure function of `(project, oldName, excludePositions, limit)`. Unit-test `scanNameMatches` directly with in-memory ts-morph projects. One integration smoke in `rename.test.ts` for the full round-trip.
- AC2 (opt-out) → unit test on `tsRename` — does the scan get called when the flag is false? Trivially done with a captured-call assertion; no disk I/O needed.
- AC3 (bail-outs) → unit test on `scanNameMatches` — short names and over-threshold candidate sets return the `skipped` shape without attempting AST resolution.

## Value / Effort

- **Value:** During a broad rename, the agent sees exactly one extra field in the response showing the identifiers it didn't touch. For a narrow rename (local variable, parameter), the field is `count: 0` and ignored. This removes the single documented cause of a 100-call rename: the agent missing that derived names exist. The fix lands in the tool, not in skill prose that agents skim inconsistently.
- **Effort:** One new module (~80 lines), response shape gains one optional object, schema gains one boolean. No changes to compiler behaviour, no new error codes, no breaking changes.

## Behaviour

- [ ] **AC1 — `rename` returns `nameMatches` with identifier-level hits, excluding compiler-rewritten locations.** Given a TypeScript project where the symbol at the target position is named `TsProvider`, after renaming to `TsMorphCompiler`: the response contains `nameMatches: { count, files, samples }` where `samples` lists identifiers in the project whose text contains the string `TsProvider` as a substring, minus the locations the compiler already rewrote. Each sample is `{ file, line, col, name, kind }`. `count` is the unbounded total; `files` is the distinct count of files containing a match; `samples` is capped at 10. String literals and comments do not appear — the scan walks AST Identifier nodes only.

- [ ] **AC2 — `includeNameMatches: false` suppresses the scan.** When the caller passes `includeNameMatches: false` (MCP/CLI/direct call), the response omits the `nameMatches` field entirely and the scan does not run. Verified by asserting the scan function is not invoked when the flag is false and the field is absent from the output.

- [ ] **AC3 — Short names and oversized candidate sets bail out.** When `oldName.length < 4` OR when the ripgrep-phase candidate count exceeds 500, the scan returns `nameMatches: { skipped: "oldNameTooShort" | "tooManyCandidates" }` without performing per-hit AST resolution. `count`, `files`, `samples` are absent in the bailed-out case. The agent can distinguish "0 matches" from "scan skipped."

## Interface

### Input

```ts
RenameArgs {
  file: string;           // unchanged
  line: number;           // unchanged
  col: number;            // unchanged
  newName: string;        // unchanged
  checkTypeErrors?: boolean;  // unchanged
  includeNameMatches?: boolean;  // NEW — default true
}
```

- **What does it contain?** A boolean that turns the name-match scan on or off. Defaults to true so broad renames get the signal without opt-in.
- **Realistic bounds:** `true` | `false` | omitted (== true).
- **Zero/empty case:** Omitted == default == true. "Absent" and "true" are equivalent.
- **Adversarial case:** N/A — a boolean.

### Output

```ts
RenameResult {
  filesModified: string[];    // unchanged
  filesSkipped: string[];     // unchanged
  symbolName: string;         // unchanged
  newName: string;            // unchanged
  locationCount: number;      // unchanged — compiler-tracked rewrites
  nameMatches?: NameMatches;  // NEW — present when includeNameMatches !== false
}

type NameMatches =
  | { count: number; files: number; samples: NameMatchSample[] }
  | { skipped: "oldNameTooShort" | "tooManyCandidates" };

interface NameMatchSample {
  file: string;           // absolute path
  line: number;           // 1-based
  col: number;            // 1-based
  name: string;           // the identifier text, e.g. "tsProviderSingleton"
  kind: string;           // ts-morph SyntaxKind name, e.g. "VariableDeclaration", "Parameter"
}
```

- **`count`:** unbounded total of identifier-level matches found across the project. Typical values 0–50; worst-case (very common name component) would have triggered the bail-out already.
- **`files`:** distinct count of files containing at least one match. Always ≤ `count`.
- **`samples`:** bounded at 10 to cap response size. Agents treat this as a review prompt, not an exhaustive list; they can call `search-text` for the complete set if needed.
- **`kind`:** the ts-morph `SyntaxKind` name of the containing declaration/reference — e.g. `VariableDeclaration`, `Parameter`, `PropertyDeclaration`, `FunctionDeclaration`, `TypeAliasDeclaration`, `InterfaceDeclaration`, `ClassDeclaration`, `Identifier` (for call-site uses). Lets agents filter without parsing.
- **`skipped`:** string reason code. `oldNameTooShort` — the renamed name was under 4 characters; substring matching produces noise dominated by coincidences. `tooManyCandidates` — the candidate set was too large to meaningfully review; agents who want it anyway can pass an explicit override (not in v1).

**Zero/empty case:** `{ count: 0, files: 0, samples: [] }` — scan ran, found nothing. Distinct from `{ skipped: "..." }` which means scan never ran.

**Adversarial case:** Renaming a symbol whose name appears in thousands of identifiers. `tooManyCandidates` bail-out returns immediately; response stays small.

## Open decisions

All resolved up-front. Recorded here so the executor has the reasoning.

### Decision 1: scan strategy — pure AST walk vs ripgrep + AST resolve

**Options:**
- **A — Pure AST walk.** Iterate `project.getSourceFiles()`, for each `getDescendantsOfKind(SyntaxKind.Identifier)`, filter by `getText().includes(oldName)`. Correct but walks every identifier in every file — 100k+ nodes on a medium-large project, every rename.
- **B — Ripgrep, then AST resolve.** First pass: `walkWorkspaceFiles` + regex `/\b\w*${escape(oldName)}\w*\b/` to find text candidates. Second pass: open each hit's file in the project, navigate to the position, check if the node is an `Identifier`, record kind if so. Drops comments and string literals naturally because they won't resolve to Identifier nodes.

**Resolution: B.** The ripgrep phase is O(project bytes) but fast (milliseconds). The AST phase is O(hits), bounded by the `tooManyCandidates` threshold. Matches the performance profile of `searchText`. Reuses `walkWorkspaceFiles` directly. The AC3 bail-out is only implementable under Option B — A has no natural place to short-circuit.

### Decision 2: what "exclude compiler-rewritten locations" means

**Options:**
- **A — Exclude by exact position.** Track `{ file, offset }` for each location the compiler rewrote; drop any scan hit whose `{ file, offset }` matches.
- **B — Exclude by name identity.** Identifiers whose text == `oldName` exactly are excluded (since those are what the compiler would have rewritten).

**Resolution: A.** Option B is wrong because a non-renamed-symbol local variable that shadows the outer symbol could legitimately also be named `oldName` and should appear in `nameMatches` so the agent knows about it. Option A is precise: exclude *exactly* the positions the compiler already handled.

### Decision 3: Vue rename coverage

**Options:**
- **A — v1 covers .ts/.tsx only; .vue renames return `nameMatches` empty (or omitted).** Note as follow-up.
- **B — v1 covers .vue too.** Requires parsing `<script>` blocks, handling SFC line/col translation.

**Resolution: A.** The documented pain case was a TS rename. Vue adds SFC parsing complexity that isn't justified for v1. Executor: for the Volar path, do not call the scan; leave `nameMatches` absent. Add a `[needs design]` entry to handoff.md for Vue coverage as part of this work.

## Security

- **Workspace boundary:** the scan reads every file under `scope.root` that matches the TS/JS extension filter. Reuses `walkWorkspaceFiles`, which already respects the scope. No new boundary-sensitive code paths.
- **Sensitive file exposure:** the scan could theoretically read a `.env` or credential file if it had a `.ts` extension — but `isSensitiveFile` already filters these in the walk path, and we reuse that. Verify the helper gets called; add a test.
- **Input injection:** `oldName` is derived from the compiler (`firstContent.slice(...)`), not user input — no new parameter flows into a regex. The regex constructed in the scan is `/\b\w*${escape(oldName)}\w*\b/`, so escape ReDoS-prone characters before interpolation.
- **Response leakage:** `samples` includes identifier names and file paths — same surface as `findReferences` already exposes. No new leakage vector.

## Edges

- **Vue rename:** `VolarEngine.rename` does not invoke the scan in v1. Agents renaming inside a `.vue` file see no `nameMatches` field. Documented in `rename.md` Constraints; handoff gets a `[needs design]` entry for Vue name-match scanning.
- **Sample ordering:** samples are returned in file-then-position order (stable). Agents reading the first sample get a representative early hit, not a random one.
- **Case sensitivity:** the scan is case-sensitive. Renaming `TsProvider` finds `tsProviderSingleton` (substring match despite first-char case) but does not find `TSPROVIDER_CONST`. Case transforms are the agent's responsibility — they can do a follow-up `search-text` with an `/i` pattern if needed.
- **Rename that produces type errors:** unchanged. Type error reporting happens in the dispatcher's post-write pass; `nameMatches` is independent.
- **`locationCount` semantics:** unchanged — it remains the count of compiler-tracked rewrites. `nameMatches.count` is distinct and additive.
- **Performance guard:** the `tooManyCandidates` threshold (500) is conservative; not tunable via input in v1. If genuine false positives emerge in practice, revisit as tech debt.

## Done-when

- [ ] All ACs verified by tests (unit + one integration smoke)
- [ ] Mutation score ≥ threshold for `src/ts-engine/name-matches.ts` specifically, and no regression on `src/ts-engine/rename.ts`
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`
- [ ] Docs updated:
  - `docs/features/rename.md` — Response section gains `nameMatches`; Constraints lists the Vue v1 exclusion
  - `.claude/skills/move-and-rename/SKILL.md` — the "do one `replace-text` pass for derived names" line is replaced with guidance on reviewing `nameMatches`; `includeNameMatches: false` mentioned as an opt-out for known-narrow renames
  - `README.md` — no change (the field is additive and agents discover it through the tool description)
- [ ] CLI and MCP both expose `includeNameMatches` on the `rename` surface
- [ ] `[needs design]` entry added to handoff.md for Vue name-match scanning (Decision 3 follow-up)
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas added to `docs/features/rename.md` or `.claude/MEMORY.md` if cross-cutting
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
