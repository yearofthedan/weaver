# `utils/` vs `domain/` boundary audit

**type:** change
**date:** 2026-03-23
**tracks:** handoff.md # utils-domain-boundary → docs/architecture.md

---

## Context

Five of the nine `utils/` files are genuine pure utilities (text-utils, extensions, globs, relative-path, assert-file). The remaining three — `errors.ts`, `sensitive-files.ts`, and root-level `security.ts` — carry domain-level concerns (engine error contracts, security policy) but live outside `domain/`. This creates sideways imports: `workspace-scope.ts` (domain/) imports `EngineError` from `../utils/errors.js` and `isWithinWorkspace` from `../security.js`. Related security functions (`isSensitiveFile` and `isWithinWorkspace`) are split across two unrelated directories.

## User intent

*As a contributor, I want domain concepts (error types, security policies) separated from pure utilities, so that import paths reflect architectural intent and new code lands in the right place by default.*

## Relevant files

- `src/utils/errors.ts` — `EngineError` + `ErrorCode` union; 32 lines, 17 importers across all layers
- `src/utils/errors.test.ts` — colocated unit tests for errors
- `src/utils/sensitive-files.ts` — `isSensitiveFile()` + constant tables; 68 lines, 3 importers (operations)
- `src/utils/sensitive-files.test.ts` — colocated unit tests for sensitive-files
- `src/security.ts` — `validateFilePath()`, `validateWorkspace()`, `isWithinWorkspace()`; 107 lines
- `src/security.test.ts` — colocated unit tests for security
- `src/domain/workspace-scope.ts` — imports from both `../utils/errors.js` and `../security.js`; will become sibling imports after the move
- `docs/architecture.md` — directory listing and shared utilities table need updating

### Red flags

- None severe. All files are well under size thresholds. No duplication or missing abstractions — just misplacement.

## Value / Effort

- **Value:** Eliminates confusion about where domain concepts live. `workspace-scope.ts` currently reaches sideways into utils/ for `EngineError` — after the move it imports a sibling. Security policy (`isSensitiveFile` + `isWithinWorkspace`) consolidates into one module. New contributors see `domain/` as the home for boundary and contract types.
- **Effort:** Low. Three file moves + one merge, all import rewrites handled by light-bridge `moveFile`/`moveSymbol`. No logic changes, no new abstractions, no API surface changes. ~20 importers to rewrite (mechanical).

## Behaviour

- [ ] **AC1: `errors.ts` moves to `domain/`** — `src/utils/errors.ts` → `src/domain/errors.ts`; `src/utils/errors.test.ts` → `src/domain/errors.test.ts`. All 17 importers rewritten to the new path. No re-export stub left in `utils/`. `EngineError` and `ErrorCode` exports unchanged.

- [ ] **AC2: `sensitive-files.ts` merges into `security.ts`** — `isSensitiveFile()`, `SENSITIVE_BASENAME_EXACT`, `SENSITIVE_EXTENSIONS`, and `SENSITIVE_BASENAME_PATTERNS` move into `src/security.ts`. Tests from `sensitive-files.test.ts` merge into `security.test.ts`. `src/utils/sensitive-files.ts` and `src/utils/sensitive-files.test.ts` are deleted. All 3 importers updated to import from the security module.

- [ ] **AC3: `security.ts` moves to `domain/`** — `src/security.ts` (now containing merged sensitive-file logic) → `src/domain/security.ts`; `src/security.test.ts` → `src/domain/security.test.ts`. All importers rewritten. `workspace-scope.ts` now imports from `./security.js` (sibling) instead of `../security.js`.

## Interface

No public interface changes. All exported functions, types, and constants retain their names and signatures. Only import paths change.

## Security

- **Workspace boundary:** N/A — no new read/write paths; existing boundary checks are moved, not modified.
- **Sensitive file exposure:** N/A — `isSensitiveFile` logic is moved unchanged; no new content access.
- **Input injection:** N/A — no new parameters introduced.
- **Response leakage:** N/A — no changes to error messages or response fields.

## Edges

- `ts-project.ts` and `file-walk.ts` remain in `utils/` — explicitly out of scope.
- No re-export stubs left behind in old locations (clean breaks, not backwards-compatible shims).
- `docs/architecture.md` directory listing and shared utilities table must reflect the new locations.
- `docs/handoff.md` current-state section must reflect the new locations.
- Execution order matters: AC2 (merge) must complete before AC3 (move), since AC3 moves the merged file.

## Done-when

- [ ] All ACs verified by tests
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated:
      - `docs/architecture.md` directory listing and shared utilities table
      - `docs/handoff.md` current-state section
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**AC1:** Completed in a prior session (commit ac07e71). `src/utils/errors.ts` → `src/domain/errors.ts`; 19 importers rewritten via `moveFile`.

**AC2:** `moveSymbol` used to move all 4 exports (`SENSITIVE_BASENAME_EXACT`, `SENSITIVE_EXTENSIONS`, `SENSITIVE_BASENAME_PATTERNS`, `isSensitiveFile`) from `sensitive-files.ts` into `security.ts`. The 3 operation importers (deleteFile, replaceText, searchText) were rewritten automatically. Tests from `sensitive-files.test.ts` merged into `security.test.ts` manually. Old source and test files deleted.

**AC3:** `moveFile` used to move `src/security.ts` → `src/domain/security.ts`. 8 files rewritten (workspace-scope.ts now imports from `./security.js` sibling). Test file moved separately to `src/domain/security.test.ts`. Import ordering fixes applied via `biome check --write`.

**Tests added:** 82 tests pass in the merged `security.test.ts` (isSensitiveFile suite absorbed from deleted file).

**`pnpm check` passes:** lint (warnings only, pre-existing), build, 808 unit tests + 29 eval tests.

**Docs updated:** `docs/architecture.md` directory listing and shared utilities table; `docs/handoff.md` current-state layout.
