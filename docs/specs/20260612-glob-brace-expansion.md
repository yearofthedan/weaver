# Glob brace expansion + reject unsupported syntax

**type:** change
**date:** 2026-06-12
**tracks:** handoff.md # search-text silently returns zero matches for an unsupported glob → docs/commands/search-text.md, docs/commands/replace-text.md

---

## Context

`globToRegex` supports `*`, `**`, `?` and literal segments; anything else is escaped to a literal by `escapePart`. So a brace glob like `**/*.{md,json,ts}` compiles to a regex demanding the literal substring `.{md,json,ts}` in the filename — no real file matches, and `search-text`/`replace-text` return `{matches: []}` / zero replacements. An agent running an "any references left before I delete this?" check reads that false negative as "nothing to worry about" and proceeds — a silent wrong answer that can cause data loss. Surfaced while dogfooding the skills-installer rename.

## User intent

*As an agent restricting a search or replace to a set of file types, I want a brace glob like `**/*.{ts,vue}` to match those files — and any glob syntax weaver cannot honour to fail loudly — so that I never act on a false "nothing matched."*

## Relevant files

- `src/utils/globs.ts` — `globToRegex`; home of the new `compileGlob` seam. `globToRegex` stays untouched (single-pattern translation); `compileGlob` validates, expands braces, and wraps it.
- `src/utils/file-walk.ts` — `walkWorkspaceFiles` calls `globToRegex` and filters by `.test(rel)`. The single chokepoint both operations share; swaps to `compileGlob`'s predicate so the fix reaches `search-text` and `replace-text` at once.
- `src/operations/searchText.ts` / `src/operations/replaceText.ts` — both call `walkWorkspaceFiles(scope.root, glob)`. No logic change; they inherit validation + expansion and propagate `INVALID_GLOB` to the caller.
- `src/domain/errors.ts` — `ErrorCode` union; add `INVALID_GLOB`.
- `src/utils/assert-file.ts` — precedent for a utils-layer file importing and throwing `EngineError` (no layering violation).
- `src/utils/globs.test.ts` — existing `globToRegex` unit tests; new `compileGlob` tests live here.
- `src/adapters/schema.ts` — `glob` field descriptions on `SearchTextArgsSchema` and `ReplaceTextBaseSchema`; update to mention brace support.
- `.claude/skills/weaver-search-and-replace/SKILL.md`, `docs/commands/search-text.md`, `docs/commands/replace-text.md`, `docs/reference/error-codes.md` — discovery + reference surfaces.

### Red flags

- `globs.ts` is small and cohesive (one exported function, ~55 lines). Adding `compileGlob` + a brace expander + a validator keeps it focused on "glob → matcher"; no decomposition needed yet, but watch the file size as the validator grows.
- `globs.test.ts` (~140 lines) is healthy and well below threshold; `compileGlob` tests append cleanly.
- **Layer-fit:** AC1–AC3 are pure functions of a glob string → unit-test `compileGlob` directly in `globs.test.ts` with no I/O. AC4 is the wiring path (operation → `walkWorkspaceFiles` → `compileGlob`) → one in-memory-fixture smoke per operation, not exhaustive integration coverage.

## Value / Effort

- **Value:** The agent's "is anything still referencing X before I delete it?" check stops returning a confident false "no matches" for a glob it considers valid. The brace pattern that triggered this bug (`**/*.{md,json,ts}`) — the same one shells and ripgrep accept — now works directly instead of forcing the agent to fan out into one search per extension. Any glob weaver genuinely cannot honour fails with a distinct error the caller can see and correct.
- **Effort:** Small. One new ~30-line expand/validate layer in an existing file, a one-line swap in `walkWorkspaceFiles`, one new error code, and doc/skill text. No new infrastructure; reuses `globToRegex` verbatim.

## Behaviour

- [ ] **Single brace group expands and matches.** `compileGlob("**/*.{md,json,ts}")` returns a predicate that is `true` for `foo.ts`, `a.md`, and `b/c.json`, and `false` for `foo.js` and `foo.txt`.
  - *Laziest wrong impl:* predicate that ignores the brace and matches everything, or that expands only the first alternative. Asserting both that multiple members match **and** a near-miss (`foo.js`) does not catches both.
  - *Layer:* unit, pure.

- [ ] **Multiple brace groups expand as a cartesian product.** `compileGlob("{src,lib}/*.{ts,js}")` is `true` for `src/a.ts`, `src/a.js`, `lib/b.ts`, and `lib/b.js`, and `false` for `test/a.ts` and `src/a.vue`.
  - *Laziest wrong impl:* expand only one group and leave the other as a literal (then `src/a.ts` fails because `{ts,js}` is literal). Asserting a cross-product member matches while a non-member with a valid prefix (`src/a.vue`) does not catches this.
  - *Layer:* unit, pure.

- [ ] **Unsupported, malformed, or explosive glob syntax throws `INVALID_GLOB`.** Each of these throws `EngineError` with code `INVALID_GLOB` (never a silent literal match): a character class `src/[abc].ts`; nested braces `a/{b,{c,d}}.ts`; an unbalanced brace `**/*.{ts`; and a glob whose brace expansion exceeds the cap (e.g. `{a,b}` repeated enough times to blow past the limit).
  - *Laziest wrong impl:* the current behaviour — escape the unsupported chars to literals and return a predicate that silently never matches. Asserting the throw (and the specific code) on each case kills it. The cap case also guards against a cartesian-blow-up DoS.
  - *Layer:* unit, pure.

- [ ] **`search-text` and `replace-text` honour brace globs and surface `INVALID_GLOB` end-to-end.** `searchText` with `glob: "**/*.{ts,md}"` over a workspace containing a matching `.ts` file and a matching `.md` file returns matches from **both** files (not `{matches: []}`). `searchText` with `glob: "src/[abc].ts"` throws `INVALID_GLOB` rather than returning an empty result. One `replaceText` smoke confirms the same chokepoint (brace glob restricts to the expanded set; invalid glob throws).
  - *Laziest wrong impl:* validation/expansion added to `compileGlob` but `walkWorkspaceFiles` still calls `globToRegex`, so operations are unchanged. Asserting matches from both extensions and the thrown code through the real operation catches the missing wiring.
  - *Layer:* integration smoke, one per operation (the two wiring paths into `walkWorkspaceFiles`).

## Interface

- **New:** `compileGlob(glob: string): (relPath: string) => boolean` in `src/utils/globs.ts`.
  - **Contains:** a predicate over a workspace-relative POSIX path (e.g. `src/foo.ts`). Returns `true` if the path matches any pattern produced by expanding the glob's brace groups.
  - **Bounds:** glob is a user-supplied string, typically <100 chars. Brace expansion is a cartesian product — capped (see Edges) to bound the pattern count; over-cap throws.
  - **Zero/empty case:** a glob with no braces expands to itself (one pattern) — identical behaviour to the old `globToRegex` path. `walkWorkspaceFiles` only calls `compileGlob` when `glob` is provided, so "no glob" still means "all files" and never reaches the validator.
  - **Adversarial case:** `{a,b}{a,b}…` cartesian blow-up → capped, throws `INVALID_GLOB`. Char classes / nested / unbalanced braces → throws `INVALID_GLOB`. `globToRegex` builds the per-pattern regex deterministically from a fixed grammar, so no ReDoS surface is introduced (the search *pattern* is separately ReDoS-checked in the operations).
- **`globToRegex`** stays exported and unchanged — `compileGlob` calls it once per expanded pattern.
- **`walkWorkspaceFiles`** swaps `const globRe = glob ? globToRegex(glob) : null` for a `compileGlob(glob)` predicate; the `.filter` uses the predicate. Validation throws here, before the git walk.
- **New error code** `INVALID_GLOB` in `ErrorCode`. Message names the offending glob and what is/isn't supported, e.g. `Unsupported glob syntax: "src/[abc].ts" (brace groups like {a,b} are supported; character classes [...], nested braces, and over-large expansions are not)`. The glob is user-supplied, not file content — no secret leakage.

## Open decisions

(none — sub-decisions resolved below)

**Resolved during design:**
- **Validation lives in the utils layer and throws `EngineError("INVALID_GLOB")`.** `assert-file.ts` already imports and throws `EngineError` from utils, so there is no layering violation, and placing the throw inside the `compileGlob` call in `walkWorkspaceFiles` covers both operations with no duplication. *Rules out* a per-operation validator (would duplicate the check).
- **Rejection is scoped to brace `{ }` and character-class `[ ]` syntax only.** These are standard glob metacharacters an agent expects to work, so silently treating them as literals is the dangerous case. `( )`, `+`, `@`, `!` (extglob) remain escaped-to-literal as today — non-standard, rarely intended, and changing them is out of scope. *Watch for:* an agent wanting a literal `[` or `{` in a filename now gets `INVALID_GLOB`; documented as a known limitation.
- **Brace expansion is a textual cartesian product, not regex alternation.** Expanding to a list of plain globs and OR-ing their regexes is true shell brace-expansion semantics and reuses `globToRegex` verbatim, rather than injecting `(a|b)` into the regex builder (which would fight `escapePart`'s escaping of `|`, `(`, `)`). *Rules out* nested-brace support in the first cut — nested braces are rejected by the validator rather than expanded (a non-recursive single-level expander would over-match them, a silent false positive).
- **Cartesian expansion is capped.** A fixed upper bound on the number of expanded patterns (implementation picks the constant, e.g. 64–256) prevents `{a,b}{a,b}…` from exploding into a DoS; over-cap throws `INVALID_GLOB`.

## Security

- **Workspace boundary:** No change. `compileGlob` only filters the already-enumerated candidate list; the boundary checks in `replaceText` (`scope.contains`) and the sensitive-file skip in both operations are untouched. A glob cannot widen the candidate set beyond what `walkWorkspaceFiles` already returns.
- **Sensitive file exposure:** N/A — no new file reads; `isSensitiveFile` filtering is unchanged.
- **Input injection:** The glob string is matched in-process against relative paths via a regex built from a fixed grammar. It is never interpolated into a shell command or path (`git ls-files` is invoked with fixed args). Brace expansion is bounded by the cap.
- **Response leakage:** The error message echoes the user-supplied glob string only — not file content. No secret or prompt-injection surface beyond what the caller already supplied.

## Edges

- A glob with no brace groups must behave exactly as before (regression: every existing `globToRegex` test case routed through `compileGlob` produces the same match results).
- Brace expansion count is capped; the cap is a guard assertion (over-cap → `INVALID_GLOB`), not a feature.
- `walkWorkspaceFiles` with no `glob` argument never calls the validator — "all files" stays the default and cannot throw.
- Validation throws before the `git ls-files` walk, so an invalid glob fails fast regardless of workspace size.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for `src/utils/globs.ts` (and `file-walk.ts` if logic there changed beyond the one-line swap)
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
- [ ] Docs updated:
      - `docs/reference/error-codes.md` — add `INVALID_GLOB`
      - `docs/commands/search-text.md` and `docs/commands/replace-text.md` — document brace-glob support and the `INVALID_GLOB` error
      - `src/adapters/schema.ts` — `glob` field descriptions mention brace support
      - `.claude/skills/weaver-search-and-replace/SKILL.md` — note that `glob` supports brace groups and that unsupported syntax errors (so agents don't read a rejection as "no matches")
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas recorded if any
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
