# `globToRegex` fails on root-level files and directory-prefixed patterns

**type:** bug
**date:** 2026-03-29
**tracks:** handoff.md # replaceText-glob-bugs

---

## Symptom

Three related failures in glob-filtered `searchText` and `replaceText`:

1. **Root-level files unreachable by any glob.** `**/*.md` matches `docs/foo.md` but not `README.md`. Even `*.md` (no slash) is internally prepended to `**/*.md` and has the same result. Root-level `package.json`, `CLAUDE.md`, `tsconfig.json`, etc. are all invisible to glob-filtered operations.

2. **Directory-prefixed globs miss direct children.** `eval/**/*.ts` matches `eval/cases/foo.ts` but not `eval/run-eval.ts`. The `**` requires at least one intermediate segment instead of matching zero-or-more.

3. **`replaceText` appears to skip JSON config files.** Originally reported as a separate `isSensitiveFile` issue, but investigation shows `isSensitiveFile` does NOT match `package.json` or other JSON config files. The symptom is a manifestation of bugs 1–2: `searchText` without a glob finds `package.json`, then `replaceText` with `**/*.json` misses it because the glob can't match root files.

Reproduction:

```
input:    globToRegex("**/*.json").test("package.json")
actual:   false
expected: true

input:    globToRegex("eval/**/*.ts").test("eval/run-eval.ts")
actual:   false
expected: true

input:    globToRegex("*.json").test("package.json")
actual:   false   (*.json prepends to **/*.json internally)
expected: true
```

## Value / Effort

- **Value:** High. Every glob-filtered `searchText` and `replaceText` call silently drops root-level files and direct children of named directories. During the weaver rename, this forced ~100 extra manual edits that `replaceText` should have handled. The failure is silent — zero errors, just zero results for files that clearly exist — which makes it especially costly for agents that can't easily diagnose why a replace "worked" but missed files.

- **Effort:** Low. The bug is entirely within `globToRegex()` (25 lines in `src/utils/globs.ts`). The fix is a regex generation change — no new infrastructure, no API changes, no ripple through callers.

## Expected

```
input:    globToRegex("**/*.json").test("package.json")    → true
input:    globToRegex("**/*.json").test("src/foo.json")    → true
input:    globToRegex("*.json").test("package.json")       → true
input:    globToRegex("eval/**/*.ts").test("eval/run.ts")  → true
input:    globToRegex("eval/**/*.ts").test("eval/a/b.ts")  → true
input:    globToRegex("src/**/*.ts").test("src/foo.ts")    → true
input:    globToRegex("src/**/*.ts").test("src/a/b/foo.ts")→ true
```

All existing passing tests in `globs.test.ts` must continue to pass — the fix must not break non-`**` patterns or patterns that already work.

## Root cause

`globToRegex` splits on `**` and joins segments with `.*`, but the `/` separators adjacent to `**` remain as literal characters in the regex. This means `**/` compiles to `.*/` (requiring at least one `/`) instead of `(.*/)?` (zero-or-more path segments including the trailing slash).

Concrete example — `**/*.ts`:
- Split on `**`: `["", "/*.ts"]`
- After escaping: `["", "/[^/]*\\.ts"]`
- Joined with `.*`: `.*/[^/]*\.ts`
- Final regex: `/^.*/[^/]*\.ts$/`

The `.*/` requires a `/` somewhere in the path. Root-level `foo.ts` (relative path `foo.ts`) has no `/`, so it fails.

Same issue for `eval/**/*.ts`:
- Split: `["eval/", "/*.ts"]`
- Joined: `eval/.*/[^/]*\.ts`
- Final regex: `/^eval\/.*\/[^/]*\.ts$/`

The `.*` can match empty, but the two literal `/` around it require `eval/SOMETHING/file.ts` — direct child `eval/file.ts` doesn't match.

Additionally, `*.json` (no slash) is prepended to `**/*.json` by the basename-only heuristic, which then hits the same root-level bug.

## Fix

Rewrite the join logic in `globToRegex` so that `**/` produces `(.*/)?` — an optional group that matches zero or more path segments including the trailing slash. This makes `**` correctly match zero-or-more directory levels.

The implementation approach: after splitting on `**`, when re-joining adjacent segments, detect the `/` boundary between the `**` and its neighbours and make it optional.

Specifically:
- If the left segment ends with `/` and the right segment starts with `/`, collapse the pair into a single `(/.*)?/` join (the `**` sits between two separators: `dir/**/file`).
- If the left segment is empty and the right segment starts with `/`, use `(.*/)?` as the prefix (the `**` is at the start: `**/file`).
- Standalone `**` with no adjacent `/` remains `.*` (matches any characters).

The basename-only heuristic (prepend `**/` when pattern has no `/`) already works correctly once the `**/` join is fixed — `*.json` becomes `**/*.json` which becomes `(.*/)?[^/]*\.json`, matching both `package.json` and `src/foo.json`.

**Adjacent inputs to test:**
- `**` alone (matches any path)
- `**/foo.ts` (exact basename at any depth)
- `src/**/test/**/*.ts` (multiple `**` segments)
- `**/*.ts` with deeply nested paths (`a/b/c/d/e.ts`)
- Empty-segment edge: `foo/**` (anything under foo, including `foo/bar` and `foo/bar/baz`)
- Pattern with no wildcards at all: `src/utils.ts` (must still work)

## Security

- **Workspace boundary:** N/A — `globToRegex` only filters the file list returned by `walkWorkspaceFiles`. The workspace boundary is enforced by `scope.contains()` and `isWithinWorkspace()`, which are not affected.
- **Sensitive file exposure:** N/A — `isSensitiveFile` filtering happens after glob matching. Fixing the glob doesn't expose sensitive files.
- **Input injection:** N/A — glob patterns are converted to RegExp via explicit character escaping. The fix changes the join logic, not the escaping.
- **Response leakage:** N/A — no change to error messages or response fields.

## Relevant files

- `src/utils/globs.ts` — `globToRegex()`, 25 lines. The only file that needs changing.
- `src/utils/globs.test.ts` — existing unit tests, 48 lines. Needs new cases for root-level and directory-prefixed patterns.
- `src/utils/file-walk.ts` — `walkWorkspaceFiles()` calls `globToRegex()`. Not changed, but verify integration.
- `src/operations/searchText.ts` — uses `walkWorkspaceFiles(scope.root, glob)`. Consumer, not changed.
- `src/operations/replaceText.ts` — uses `walkWorkspaceFiles(scope.root, glob)`. Consumer, not changed.

## Red flags

None. `globs.ts` is well-isolated (25 lines, one export, one responsibility). Test file is 48 lines — well under threshold. No duplication or structural issues to clean up first.

## Edges

- Existing globs without `**` (e.g. `src/*.ts`) must continue to work unchanged.
- The `?` wildcard must not be affected by the `**` fix.
- `**` alone (no filename part) should match all files.
- Multiple `**` in one pattern (e.g. `src/**/test/**/*.ts`) must each independently match zero-or-more segments.
- The basename-only heuristic (no `/` → prepend `**/`) must keep working — `*.ts` should match `foo.ts` at root and `src/foo.ts`.

## Done-when

- [x] Reproduction case now produces expected output — `globToRegex("**/*.json").test("package.json")` returns `true`
- [x] `globToRegex("eval/**/*.ts").test("eval/run.ts")` returns `true`
- [x] `globToRegex("*.json").test("package.json")` returns `true` (via basename heuristic)
- [x] Regression test covers root-level files, directory-prefixed direct children, multi-segment `**`, and all adjacent inputs listed above
- [x] All existing `globs.test.ts` tests still pass
- [ ] Mutation score ≥ 80% for `src/utils/globs.ts`
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated if public surface changed — no changes needed; glob syntax in tool descriptions is unchanged
- [x] Tech debt discovered during investigation added to handoff.md as [needs design] — none discovered
- [x] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting — none needed
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Reflection:** The investigation revealed that all three reported bugs shared a single root cause — `globToRegex` joining `**` segments with `.*` instead of `(.*/)?`. The "JSON config skip" (bug 1) was not an `isSensitiveFile` issue as originally suspected — it was the glob bug making root-level files invisible. Identifying this saved implementing an unnecessary fix to the security layer. The fix was 40 lines of implementation change, with 93 lines of new tests covering 15 assertions across root-level, directory-prefixed, and edge-case patterns. TDD worked well here — all 8 new test groups failed before the fix and passed after.

- **Tests added:** 15 new assertions across 13 test cases (root-level matching, directory-prefixed direct children, adjacent edge cases)
- **Mutation score:** not yet run for `src/utils/globs.ts` — deferred to next session
- **Architectural note:** the custom `globToRegex` was kept over switching to a library (picomatch/minimatch) given the project's strict dependency posture. The fix is targeted and well-tested.
