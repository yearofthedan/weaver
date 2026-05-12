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
- `docs/code-standards.md` — "Use fixtureTest for fixture-per-test setup" section guides agents to the current pattern; must reflect the new shape.

### Red flags

- Three test files (`move-symbol.test.ts`, `move-symbol-fallback.test.ts`, `extract-function.test.ts`) carry local `setupProject` / `makeTempDir` helpers with substantially the same shape — clear duplication that the new helpers subsume. Delete the locals as part of migration.
- `extract-function.test.ts:168` mixes patterns: a `fixtureTest`-style describe block contains one `it()` that uses the standalone `copyFixture` + try/finally. Migration unifies the file under the new helpers.

**Layer-fit per AC:** The helpers themselves are pure file-system manipulation. Unit-test them directly against a tmp dir — no project graph, no engine wiring needed. One smoke test exercises composition end-to-end in a real test file.

## Value / Effort

- **Value:** Tests that need bespoke per-test content currently cost ~6 lines of cleanup boilerplate before the first assertion. The new shape lets test authors say `await seedInlineFixture({ ... })` and start asserting. The describe-level override mechanism is replaced by a body-level call so a single API serves both shared-fixture and per-test-content cases — same import, same shape, no "scroll up to find the override" friction. Three duplicated `setupProject` / `makeTempDir` helpers disappear.
- **Effort:** The core change is small: replace the `fixtureName` fixture with two function fixtures (`seedNamedFixture`, `seedInlineFixture`) and drop the `simple-ts` default. Migration touches ~28 `fixtureTest` callers (mechanical: replace each `test.override({ fixtureName: X })` with `await seedNamedFixture(X)` at the top of each test body) and ~8 manual-`mkdtempSync` callers. Total ~35-40 test files; all mechanical, no production code.

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

- The standalone `copyFixture(name): string` export remains. It has ~13 call sites outside the per-test fixture loop (integration tests with `beforeAll` setups, tests sharing a dir across cases). These are out of scope for this slice.
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

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for `src/__testHelpers__/fixtures/fixtures.ts`
- [ ] `pnpm check` passes (full test suite — migration touches many files)
- [ ] No `test.override({ fixtureName })` calls remain in `src/**`
- [ ] Manual `mkdtempSync` + `afterEach(cleanup)` patterns in tests whose only tracked resource is the dir are migrated to `fixtureTest` + `seedInlineFixture` (per the Relevant files list — ~8 files). Tests that also track subprocesses or other lifecycle resources are out of scope.
- [ ] Local `makeTempDir` / `setupProject` helpers in `extract-function.test.ts`, `move-symbol.test.ts`, `move-symbol-fallback.test.ts` are deleted in favour of the new helpers.
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md` after the change.
- [ ] `docs/code-standards.md` "Use fixtureTest for fixture-per-test setup" section rewritten to describe `seedNamedFixture` / `seedInlineFixture` and remove the `test.override({ fixtureName })` guidance.
- [ ] handoff.md "Next things to build" entry for this task removed.
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`.
- [ ] Non-obvious gotchas added to relevant `docs/internals/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting.
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended.
