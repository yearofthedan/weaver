# engine.test.ts fails in Stryker sandbox

**type:** bug
**date:** 2026-03-22
**tracks:** handoff.md # engine.test.ts-stryker

---

## Symptom

`TsMorphEngine getDefinitionAtPosition returns definition location` fails consistently in Stryker's dry run with "No symbol at line 3, col 13". Passes in normal `pnpm test`. Blocks all mutation testing for `engine.test.ts` mutants.

```
input:    pnpm test:mutate (Stryker dry run)
actual:   "No symbol at line 3, col 13" — test fails
expected: test passes (greetUser found at line 3, col 13)
```

## Expected

The Stryker dry run passes. All `engine.test.ts` tests behave identically in Stryker's sandbox and in normal `pnpm test`.

## Root cause

Fixture files at `src/__testHelpers__/fixtures/simple-ts/src/*.ts` match the `mutate` glob `src/**/*.ts` in `stryker.config.mjs`. Stryker's instrumenter injects mutation switches into these files in the sandbox (e.g., wrapping `greetUser("World")` with `stryMutAct_9fa48(0) ? ...`). When `copyFixture()` copies these instrumented files to a temp dir, hardcoded line/col positions no longer correspond to the original source positions.

Line 3 col 13 in the original `main.ts` points to `greetUser` in `console.log(greetUser("World"))`. After instrumentation, the expression is wrapped, shifting column positions. The symlink variant at `engine.test.ts:233` likely also fails for the same reason.

`__testHelpers__` directories exist at multiple depths (`src/__testHelpers__/`, `src/ts-engine/__testHelpers__/`, `src/ports/__testHelpers__/`), so the exclusion must use a recursive glob.

## Fix

- [ ] **AC1:** Add `!src/**/__testHelpers__/**` to the `mutate` array in `stryker.config.mjs` with a comment explaining why fixture and test helper files must not be instrumented.
- [ ] **AC2:** Verify the Stryker dry run passes — the `getDefinitionAtPosition` test and its symlink variant must pass.

## Security

- **Workspace boundary:** N/A — config-only change to test infrastructure.
- **Sensitive file exposure:** N/A — no production code or file handling affected.
- **Input injection:** N/A — no user-supplied strings involved.
- **Response leakage:** N/A — no error messages or response fields changed.

## Edges

- Other tests using hardcoded positions on fixture files (e.g., `resolveOffset(file, 1, 17)`) may also be subtly broken but happen to pass because Stryker's instrumenter doesn't wrap function declarations (only expressions), so line 1 positions in `utils.ts` survive.
- No regression risk to happy path — fixture files have no meaningful mutants to test.

## Relevant files

- `stryker.config.mjs` — mutate glob configuration (the fix target)
- `src/ts-engine/engine.test.ts:78-88` — failing test
- `src/ts-engine/engine.test.ts:229-241` — symlink variant (likely also failing)
- `src/__testHelpers__/fixtures/simple-ts/src/main.ts` — fixture file being instrumented
- `src/__testHelpers__/fixtures/fixtures.ts` — `copyFixture()` implementation

## Red flags

None — this is a clean config fix.

## Done-when

- [x] `!src/**/__testHelpers__/**` in mutate exclusions
- [x] Stryker dry run passes for `engine.test.ts`
- [x] `pnpm check` passes
- [x] Spec moved to `docs/specs/archive/` with Outcome section appended

## Outcome

**Reflection:** Straightforward config bug. Root cause was immediately clear from reading the mutate glob and understanding Stryker's instrumentation model. The user's catch on `__testHelpers__` at any depth was important — the original exclusion `!src/__testHelpers__/**` would have missed `src/ts-engine/__testHelpers__/` and `src/ports/__testHelpers__/`. One-line fix, verified by dry run (716 tests, 51 seconds).

**Process lesson:** The original spec split this into two "ACs" (add exclusion + verify dry run), which forced unnecessary overhead — the execution agent implemented AC1 without verification, then the orchestrator ran AC2 manually. Verification is not an AC; it's part of Done-when. Bugs don't have ACs — the Expected section defines the target, the Fix section describes the implementation path, and Done-when defines verification. Updated the bug template, spec skill, and slice skill accordingly.

- Tests added: 0 (config-only fix; dry run is the verification)
- Mutation score: N/A (no production code changed)
- Files changed: `stryker.config.mjs` (1 line added), plus bug template and skill updates
