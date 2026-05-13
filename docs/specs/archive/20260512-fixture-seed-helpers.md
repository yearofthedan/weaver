# fixtureTest body-level seed helpers

**type:** change
**date:** 2026-05-12
**tracks:** handoff.md # fixtureTest callback variant for per-test inline setup → docs/code-standards.md (test-helper section)

---

## Context

`fixtureTest` (in `src/__testHelpers__/fixtures/fixtures.ts`) uses `test.override({ fixtureName })` at the describe level, which seeds every test in the block from the same pre-recorded fixture. Tests that need different content per test (e.g. extract-function's TS and Vue suites, parts of searchText/replaceText/move-symbol) cannot use it and instead duplicate a manual pattern: a `dirs: string[]` array, an `afterEach(() => dirs.splice(0).forEach(cleanup))`, a local `makeTempDir()` helper, and per-test `writeFileSync` calls. The pattern appears in ~8 test files with the same shape, and three of those (`move-symbol.test.ts`, `move-symbol-fallback.test.ts`, `extract-function.test.ts`) further wrap it in near-identical `setupProject` helpers.

## User intent

*As an engineer (or agent) writing a test in this repo, I want to declare the test's working-directory contents inline in the test body — whether by seeding from a pre-recorded fixture, by writing arbitrary files, or both — so that I can author per-test setup without describe-level scoping ceremony or manual tmp-dir cleanup.*

## Relevant files

- `src/__testHelpers__/fixtures/fixtures.ts` — current `fixtureTest`, `copyFixture`, `FIXTURES` definitions; edit target.
- `src/__testHelpers__/helpers.ts` — barrel re-exports for the new helpers.
- `src/ts-engine/extract-function.test.ts` — motivating case; manual `mkdtempSync` for both TS and Vue suites.
- `src/operations/extractFunction.test.ts` — same pattern, simpler.
- `src/operations/searchText.test.ts` — edge-case tests duplicate try/finally cleanup; also uses standalone `copyFixture` in `beforeAll`.
- `src/operations/replaceText.test.ts` — duplicated try/finally cleanup in edge cases.
- `src/ts-engine/move-symbol.test.ts` — local `setupProject` helper builds files from a map (parallel implementation of `seedInlineFixture`).
- `src/ts-engine/move-file.test.ts` — only file relying on the implicit `simple-ts` default of `fixtureTest`; needs explicit `seedNamedFixture` calls after migration.
- `src/ts-engine/{extract-function,remove-importers,rename,delete-file,move-symbol-errors,move-directory}.test.ts`, `src/plugins/vue/scan.test.ts` — seven files that use `fixtureTest` for most cases but call standalone `copyFixture` inside a single test that needs a different fixture from the describe-level override. Each `copyFixture(...)` + manual `cleanup(...)` becomes `await seedNamedFixture(...)` inside the test body.
- `docs/code-standards.md` — "Use fixtureTest for fixture-per-test setup" section guides agents to the current pattern; must reflect the new shape.

### Red flags

- Three test files (`move-symbol.test.ts`, `move-symbol-fallback.test.ts`, `extract-function.test.ts`) carry local `setupProject` / `makeTempDir` helpers with substantially the same shape — clear duplication that the new helpers subsume. Delete the locals as part of migration.
- `extract-function.test.ts:168` mixes patterns: a `fixtureTest`-style describe block contains one `it()` that uses the standalone `copyFixture` + try/finally. Migration unifies the file under the new helpers.

**Layer-fit per AC:** The helpers themselves are pure file-system manipulation. Unit-test them directly against a tmp dir — no project graph, no engine wiring needed. One smoke test exercises composition end-to-end in a real test file.

## Value / Effort

- **Value:** Tests that need bespoke per-test content currently cost ~6 lines of cleanup boilerplate before the first assertion. The new shape lets test authors say `await seedInlineFixture({ ... })` and start asserting. The describe-level override mechanism is replaced by a body-level call so a single API serves both shared-fixture and per-test-content cases — same import, same shape, no "scroll up to find the override" friction. Three duplicated `setupProject` / `makeTempDir` helpers disappear, and seven mixed-pattern files that mix `fixtureTest` + standalone `copyFixture` collapse to a single pattern.
- **Effort:** The core change is small: replace the `fixtureName` fixture with two function fixtures (`seedNamedFixture`, `seedInlineFixture`) and drop the `simple-ts` default. Migration touches ~28 `fixtureTest` callers (mechanical: replace each `test.override({ fixtureName: X })` with `await seedNamedFixture(X)` at the top of each test body), ~8 manual-`mkdtempSync` callers, and ~7 `fixtureTest` files that call standalone `copyFixture` for a one-off different fixture inside a single test. Total ~43 test files; all mechanical, no production code.

## Behaviour

- [ ] Given `fixtureTest`'s `dir` fixture is used without calling either seed helper, the test receives a fresh empty temp directory and the directory is removed after the test (assert via `fs.existsSync(dir) === true` inside the test, `=== false` after). *Layer: unit — direct fs assertion.*
- [ ] Given `await seedInlineFixture({ "tsconfig.json": "{}", "src/nested/a.ts": "export {}" })`, both files exist at the expected paths with the supplied content after the call returns; the `src/nested/` parent directory is created on demand. *Layer: unit.*
- [ ] Given `await seedNamedFixture(FIXTURES.simpleTs.name)`, the named fixture's directory tree (resolved against `src/__testHelpers__/fixtures/<name>/`) is copied into `dir`; reading a known file from the fixture (`src/utils.ts`) returns its committed content. *Layer: unit.*
- [ ] Given `await seedNamedFixture(FIXTURES.simpleTs.name)` followed by `await seedInlineFixture({ "src/utils.ts": "OVERRIDDEN" })` in the same test, the final content of `src/utils.ts` is `"OVERRIDDEN"` (later calls overwrite earlier file contents at the same path); files not mentioned by `seedInlineFixture` keep the fixture content. *Layer: unit.*

> Migration of existing callers is verified by `pnpm check` (full test suite). It is a Done-when item, not an AC — the observable behaviour above is what the executor must implement; the migration is mechanical follow-through.

## Interface

```ts
// src/__testHelpers__/fixtures/fixtures.ts (sketch)

export const fixtureTest = baseTest.extend<{
  dir: string;
  seedNamedFixture: (name: FixtureName) => Promise<void>;
  seedInlineFixture: (files: Record<string, string>) => Promise<void>;
}>({
  dir: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-"));
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  },
  seedNamedFixture: async ({ dir }, use) => {
    await use(async (name) => copyDirSync(path.join(__dirname, name), dir));
  },
  seedInlineFixture: async ({ dir }, use) => {
    await use(async (files) => {
      for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
      }
    });
  },
});
```

**Fields and contents:**

- `dir: string` — absolute path to a fresh temp dir under `os.tmpdir()` (e.g. `/tmp/ns-abc123`). Empty on entry. The directory is removed after the test regardless of whether either seed helper was called. Zero/empty case: directory is empty (this is the default — tests that don't need any content can ignore the seed helpers entirely).
- `seedNamedFixture(name)` — `name: FixtureName` (one of the keys in `FIXTURES`). Copies the corresponding `src/__testHelpers__/fixtures/<name>/` directory tree into `dir`. Returns when copy completes. Adversarial case: calling with the same `name` twice is a no-op-equivalent overwrite (idempotent).
- `seedInlineFixture(files)` — `files: Record<string, string>` mapping relative-to-`dir` paths to file contents. Parent directories created via `mkdirSync({ recursive: true })`. Existing files are overwritten silently (mirrors `writeFileSync`). Zero case: empty object is a no-op. Realistic bound: ~50 files per call (typical test scaffold sizes); no hard upper bound.

**Removed from the public surface:**

- The `fixtureName` fixture on `fixtureTest`. The implicit `simple-ts` default is gone — tests must explicitly seed.
- The `test.override({ fixtureName })` describe-level pattern. No call sites remain in `src/**` after migration.

**Unchanged (kept):**

- The standalone `copyFixture(name): string` export remains. After this slice, its remaining callers are: (a) integration tests that pair `copyFixture` with subprocess lifecycle tracking (~7 files; would migrate awkwardly because fixtureTest doesn't manage child processes), and (b) `operations/searchText.test.ts` which uses `beforeAll` to share one dir across many tests (structural mismatch with `beforeEach`-style fixtureTest). Both deferred to a follow-up [chore] entry in `handoff.md`.
- `FIXTURES` constant and `FixtureName` type — still the source of truth for fixture names.

## Open decisions

(none — all decisions resolved during spec walk-through)

## Security

- **Workspace boundary:** N/A — test-only code; `dir` is in `os.tmpdir()`; helpers write only into `dir` via `path.join`. No new path traversal surface (relative paths from test authors are trusted as authored code).
- **Sensitive file exposure:** N/A — no production code path; no `.env` reads.
- **Input injection:** N/A — `Record<string, string>` keys are test-author-controlled (trusted source).
- **Response leakage:** N/A.

## Edges

- `src/ts-engine/move-file.test.ts` is the only file that currently relies on `fixtureTest`'s implicit `simple-ts` default. Every test in that file must gain an explicit `await seedNamedFixture(FIXTURES.simpleTs.name)` call; no test should silently change behaviour.
- Vitest fixtures are lazy: a test that destructures only `{ dir }` does not pay the cost of the seed helpers. Migration should not destructure helpers a test does not use.
- The order of helper calls matters for files written twice at the same path (last-write-wins). Tests that compose the two helpers should rely on this and assert the final content.
- Integration tests that use the standalone `copyFixture` in `beforeAll`/`afterAll` (subprocess-spawning daemon tests, etc.) are out of scope — they need a different lifecycle than `fixtureTest` provides. The standalone export stays for them.
- `seedNamedFixture` and `seedInlineFixture` may be called in either order, multiple times, or not at all within a test. The implementation must not assume a single canonical call.

## Done-when

- [x] All ACs verified by tests
- [x] Mutation score ≥ threshold for `src/__testHelpers__/fixtures/fixtures.ts` (94.12%, one survivor classified as dead defensive code and removed)
- [x] `pnpm check` passes (full test suite — migration touches many files)
- [x] No `test.override({ fixtureName })` calls remain in `src/**`
- [x] Manual `mkdtempSync` + `afterEach(cleanup)` patterns migrated where the dir was the sole tracked resource (`extract-function.test.ts`, `extractFunction.test.ts`, `move-symbol.test.ts`, `move-symbol-fallback.test.ts`, `moveSymbol.test.ts`, plus the inline cases in `replaceText.test.ts`). Integration tests with subprocess lifecycle (e.g. `move-file.test.ts`'s git-tracked test) intentionally retain `mkdtempSync`.
- [x] Per-test `copyFixture(...)` + `cleanup(...)` calls inside `fixtureTest` files (Category B) replaced with `await seedNamedFixture(...)` in the test body, via the codemod sweep.
- [x] Local `makeTempDir` / `setupProject` / `makeTmpDir` / `writeTsConfig` helpers in `extract-function.test.ts`, `move-symbol.test.ts`, `move-symbol-fallback.test.ts` deleted in favour of the new helpers.
- [x] Follow-up `[chore]` entry added to `handoff.md` for migrating remaining standalone-`copyFixture` callers (integration tests with subprocess lifecycle + `searchText.test.ts` `beforeAll`).
- [x] No touched source or test file exceeds the hard flag in `docs/code-standards.md` after the change.
- [x] `docs/code-standards.md` "Use fixtureTest for fixture-per-test setup" section rewritten to describe `seedNamedFixture` / `seedInlineFixture` and the standalone `copyFixture` escape hatch.
- [x] handoff.md "Next things to build" entry for this task removed.
- [x] Tech debt discovered during implementation added to handoff.md (the Category A + C migration entry).
- [x] Non-obvious gotchas: see Outcome section below — `it()` is plain vitest with no fixture access, vitest config's exclude pattern needed narrowing.
- [x] Spec moved to `docs/specs/archive/` with Outcome section appended.

## Outcome

### What shipped

- New body-level helpers on `fixtureTest`: `seedNamedFixture(name): Promise<void>` and `seedInlineFixture(files: Record<string, string>): Promise<void>`. The `dir` fixture is now always a fresh empty temp dir; cleanup is unchanged.
- The `fixtureName` fixture and the `test.override({ fixtureName })` mechanism are gone.
- 30 test files migrated by a one-off ts-morph codemod (274 `test()` calls transformed across 77 describe-scoped overrides, plus 17 file-top-level overrides). Five additional files (with `setupProject` / `makeTempDir` helpers) migrated by hand. Several "tests that seed a fixture they never use" cleaned up to drop unnecessary work.
- `docs/code-standards.md` rewritten for the new pattern; `vitest.config.ts` exclude pattern narrowed so the new `fixtures.test.ts` is discovered while fixture-content directories remain excluded.

### Numbers

- Test count: 963 → 962 (one merged in `fixtures.test.ts` using `onTestFinished`).
- 5 unit tests added for the new helpers (AC coverage: empty default + cleanup; inline writes + parent dirs; named copy; composition overwrite).
- Mutation score for `fixtures.ts`: 94.12% (16 killed, 1 survivor — classified as dead defensive code per Rule 20 and removed).
- 7 commits on the feature branch: spec + Category-B expansion + helper build + codemod sweep + manual mkdtempSync migration + fixtureName removal + review-changes fixes + dead-branch removal.

### Reflection

**What went well.** The phased approach — additive build, then codemod migration, then API removal — meant the suite stayed green between commits. Backward compat during migration (keeping `fixtureName` as an optional fixture in phase 1) avoided a brittle "everything broken at once" state. The ts-morph codemod was a great fit for the 274-test sweep: 30 minutes to write and debug, vs. several hours of mechanical Edit calls with typo risk. Dogfooding insight: weaver's existing operations (rename, move-file) can't perform this kind of structural, condition-driven AST rewrite — but the underlying ts-morph API does it cleanly.

**What did not go well.** The execution-agent dispatches failed twice on permissions before being abandoned; the migration was done from the main session instead. The codemod's first version had three bugs caught only by running the suite: (1) it walked direct describe children only and missed nested describes that inherit fixtures, (2) it transformed `it()` calls that don't have fixtureTest's fixture context, and (3) it inserted `await` into non-async tests. Each iteration required reverting all migration changes and re-running. The pattern: write a transformation that handles a "simple" case, run it, then expand for the cases it missed — three full revert-rerun cycles. Cheaper than manual edits even so, but worth noting that codemods on real codebases need to handle the long-tail variations.

**What took longer than it should have.** Restoring the column-number and intent comments stripped by the codemod was tedious — those comments had been added carefully and the codemod treated them as transformation noise. A v2 codemod should preserve leading comments on the test() call and any inline comments on lambda arguments. Also: discovering that one file (`engine.deleteFile.test.ts`) had a *file-top-level* `test.override` (not inside any describe) surfaced only on the third codemod iteration.

**Recommendations for the next agent picking up related work.**
- The standalone `copyFixture(name): string` export is still used by ~13 callers across integration tests and `searchText.test.ts`'s `beforeAll`. Those are tracked as the next `[chore]` entry in `handoff.md`. Migrating them would let us delete the standalone export and the `cleanup` helper entirely.
- If you write codemods: walk *recursively* into nested describes when scoping inheritance applies; respect describe-level overrides separately from file-top-level ones; never transform `it()` calls assuming they share fixtures; mark functions async when you insert `await`. The codemod here lives in git history (commit message references it) — not committed, since it was a one-off.
- The `force: true` survivor on `rmSync` was a textbook Rule 20 case: defensive code guarding an impossible state (the dir always exists at cleanup). Look at survivors on `force`/`recursive`/`true` literals first when triaging — they often indicate dead defence.
