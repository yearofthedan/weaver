# Code Standards

Project-wide coding standards. Referenced by agents, skills, and CLAUDE.md.

This doc answers *"is this written well?"* at implementation time. For *"is this the right shape?"* — where logic lives, what the boundaries are, what gets exposed — see [design-principles.md](design-principles.md), decided earlier, at design time. Several checks below (the test quality model, the source-extraction review) are the implementation-time symptoms of those design-time principles, and cross-link where relevant.

These checks happen **before** implementing, not after. Read the target files, work through the assessment below, and decide whether extraction or refactoring is needed before adding new code. This is cheaper and cleaner than untangling changes after the fact.

## Before extending an existing file

Read the file first. Then ask three questions:

1. **Is my change a different responsibility from what's here?** If yes, the new code belongs somewhere else — a new file, an existing utility, a sibling module.
2. **Is there code already in this file that should be extracted?** Generic logic, helpers usable elsewhere, anything not specific to this file's purpose. Pull it out before adding more.
3. **Am I about to duplicate logic that exists elsewhere?** Search the codebase first. Extend or generalize a near-match rather than parallel-implementing.

Do this *before* implementing — it's cheaper and cleaner than untangling afterwards. The "Refactoring triggers" section below lists the signals worth weighing during this assessment.

**On file length specifically:** length is a signal that the questions above are worth asking, not a trigger to split. Around 300 lines, mixed responsibilities are common; over 500, almost always. Length alone never justifies a split.

**Anti-pattern: splitting to hit a number.** Do not break a cohesive file into smaller files just because it crossed a length threshold. That trades one real cost (a long file) for several worse ones: more imports, harder navigation, scattered logic, and helpers that exist only because something had to be moved. If you can't name the distinct responsibility a new file would own, leave it alone.

## Reuse before create

Before writing a new helper, utility, or abstraction:

1. Search the codebase for existing functions that do the same thing (or close enough to extend).
2. Check barrel exports and `src/utils/` for discoverable shared logic.
3. If you find a near-match, extend or generalize it rather than creating a parallel implementation.

## Comments

Comments exist to provide context that cannot be gathered from names, types, and structure alone. If a comment restates what the code already says, delete it.

**Rules:**

- **Never reference spec identifiers** (AC numbers, spec slugs, task IDs) in code or tests. Describe the *behaviour*, not the changeset that introduced it.
- **Don't narrate the code.** `// Symbol is removed from source` before `expect(...).not.toContain("BAR")` adds nothing — the assertion already says that. If the intent isn't clear from the assertion, rename variables or extract a helper with a descriptive name.
- **Prefer a well-named function over a comment.** If you need a comment to explain *what* a block does, extract it into a function whose name provides that context.
- **Doc blocks over inline comments.** A single JSDoc block on a function is better than comments scattered through the body.
- **Excessive comments are a refactoring trigger.** If a function needs many comments to be understood, it's too complex — simplify or decompose it.
- **Keep comments proportionate, in plain sentences.** A comment should be shorter than the code it explains; if a header block dwarfs the file, cut it to the one non-obvious point. Write brief, complete sentences — not exhaustive paragraphs, and not clipped fragments.

**Test-specific:**

- Do not add comments like `// Verify X` or `// Check that Y` above assertions. The assertion *is* the verification. If the intent is unclear, improve the test structure: use descriptive `it()` names, extract setup into named helpers, or use custom matchers.
- Group related assertions naturally with blank lines rather than comment headers.

## Tests

Tests are production code. Everything above applies: read before extending, look for extraction opportunities, avoid duplicate setup, no comments restating assertions, no unreachable branches. The dimensions below cover what's *additional* to test code — not what replaces the standards above.

### Quality model

A short test file can still be unhealthy. Assess test health on these dimensions:

- **Layer fit.** Is each test at the lowest layer that can verify the behaviour? Pure logic belongs at the unit layer with in-memory dependencies. Integration tests verify wiring, not exhaustive input variations. (When a behaviour *can't* be reached at a low layer, that's usually the [Dependency Rule](design-principles.md) failing in the source — the logic is in too outer a layer; fix the shape, not the test.)

  **Scenario or focused test?** For an operation's observable behaviour — what a caller receives and what happens to the workspace — write a [scenario](quality.md#strategy). The runner compares whole file content and the whole response, so it cannot be narrowed to the substring the author thought to check. Keep a focused test when the case needs an input the format refuses to build: a symlinked root, a git index out of step with disk, a write landing between project load and the call, or a direct engine call with no operation around it. Those tests read as redundant because their mutants die elsewhere — mutation parity is not a reason to delete one, since they are the only place those inputs exist.
- **Setup proportionality.** Is the setup proportional to what's being verified? When the fixture ceremony dwarfs the assertion, the logic under test likely belongs behind a seam that can be tested with lighter dependencies.
- **Coverage directness.** Is the behaviour asserted through a direct call, or indirectly through a chain of collaborators? Indirect coverage is fragile — a change to an unrelated collaborator can silently break the path that exercises the real logic.
- **Mutation resilience.** Would a logic inversion in the code under test be caught? Assertions must pin exact output shapes and cover at least one boundary. TypeScript types don't kill mutants — only assertions do. Ask this *per test at write time*, not as an after-the-fact pass. In particular, when a test is templated from a sibling (adjacent `describe`, copied `it.each` row), the sibling's input *variations* are coverage only if the new subject branches on them — a second input that flows through the identical path with no distinguishing logic (e.g. a second subcommand string for a function that takes no subcommand) kills no extra mutant. Drop it; don't copy it.
- **Assertion clarity.** Are assertions inline and direct, or hidden behind helpers that obscure what's being checked? Indirection in assertions makes test failures harder to diagnose. Prefer inline assertions with clear variable names over extracted assertion helpers.
- **Behaviour, not shape, when a function returns behaviour.** When the subject builds and returns functions (predicates, resolvers, handlers — a config object, a factory), asserting on the returned *structure* leaves the returned *functions* unexecuted, and they are usually the part that decides anything. Every branch inside them reads as uncovered. **Call what you were handed.** A builder returning `{ matches, hardFails, isSkillMdRead }` needs each predicate invoked against a representative input and its negation — asserting `tools`, `maxSteps`, and message order proves only the packaging.
- **Defect reachability.** A test is worth keeping only if a reachable code path — or a plausible future edit — could produce the failure it guards. Cut a test that: asserts the absence of a state the code structurally cannot produce (there is no path that could make it true — e.g. asserting a function that only `map`s over its inputs excludes an input it was never given); couples to shipped external *content* or exact prose *wording* rather than structure/behaviour (it breaks on benign edits and kills no logic mutant — assert the shape, not the copy); or re-encodes a constant/table as test data and asserts the table equals a copy of itself. These pass forever, fail only on harmless edits, and dull the suite's signal.

### Source extraction = test review

Extracting a new entity (service, utility, domain object) changes the testing surface. The test suite must be reviewed in the same pass — not as a follow-up, not as a separate task. If the source moved, the tests move with it.

- Unit tests for the extracted entity using the lightest dependencies that exercise the logic
- Integration tests thinned to orchestration only — edge cases that the unit layer now covers directly are removed from the integration layer
- No assertion weakened — every previously-asserted behaviour is still asserted somewhere

### Refactoring hierarchy

A large test file is usually a symptom — diagnose the cause before splitting. Work top to bottom:

1. **Push integration tests down.** If an integration test is large because it exercises lots of internal logic, extract that logic into units with their own tests. Keep the integration test narrow — it should verify the integration point, not re-test the units.
2. **Decompose the source.** If a unit test is large because the unit under test is complex, the source itself probably needs decomposition. Split the source; tests follow naturally.
3. **Extract shared fixtures and setup.** Repeated project scaffolding (`mkdirSync`, `writeFileSync`, tsconfig boilerplate) belongs in shared helpers. Co-locate in `tests/helpers/` or a `__helpers__` file next to the tests.
4. **Use parameterised tests.** When multiple cases test the same behaviour with different inputs, use `it.each` / `describe.each` rather than duplicating test bodies.
5. **Split by feature area (last resort).** If the above steps aren't enough, split the file along feature boundaries. This is a last resort because it can obscure which tests cover which code paths.

### Colocate test helpers with their domain

Test doubles belong near the concept they mock, not in a generic folder. `makeMockCompiler` mocks the `Compiler` interface — it belongs in `tests/compilers/__helpers__/`, not `tests/helpers/`. Use `__helpers__/` subfolders per domain area.

### Test layer must match code layer

Tests follow their subject. A test for an operation lives in the operation's test file; a test for an engine method lives in the engine's test file. If a test colocated with one subject is exercising another subject's logic indirectly, push it down to the right file.

Size doesn't override this. When a test file grows large enough to give pause, that triggers assessment via the refactoring hierarchy above — not a new test file as a workaround. A new test file is only justified after the hierarchy has been applied and the file still warrants splitting along feature boundaries.

### Use fixtureTest with body-level seed helpers

Use `fixtureTest` from `src/__testHelpers__/helpers.ts` for any test that needs a temp directory. Each seed helper returns the absolute path of a fresh per-test temp dir (cleaned up after). Both helpers write into the same dir, so they compose:

```ts
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";

test("uses a pre-recorded fixture", async ({ seedNamedFixture }) => {
  const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
  // dir now contains a copy of the simple-ts fixture tree
});

test("uses inline file content", async ({ seedInlineFixture }) => {
  const dir = await seedInlineFixture({
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }),
    "src/target.ts": "export function foo() {}",
  });
});

test("composes both", async ({ seedNamedFixture, seedInlineFixture }) => {
  const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
  await seedInlineFixture({ "src/utils.ts": "OVERRIDDEN" });  // last write wins
});
```

Each test declares its own setup in the body — no describe-level override, no manual `dirs` array, no standalone `copyFixture`/`cleanup` helper. For the rare test that wants a fresh empty temp dir without seeding, the bare `dir` fixture (`async ({ dir }) => ...`) remains exposed. Every caller — including subprocess-lifecycle integration tests and `it.each`-style parameterized cases — goes through `fixtureTest`.

Fixture project scaffolds under `src/__testHelpers__/fixtures/<name>/**` are copied into temp dirs at test time, not statically imported — some (`ts-errors`, `ts-100-errors`) contain deliberately broken TypeScript as `getTypeErrors` test input. `tsconfig.test.json` excludes `src/__testHelpers__/fixtures/*/**` for this reason; a new tsconfig covering `src/` must exclude the same glob or it will report the fixtures' intentional errors as real ones.

For a parameterized test that needs fixture access, use `test.for` (not `test.each`) — only `.for` injects the fixture context as the callback's last argument:

```ts
test.for([
  ["a function", "export function FOO(): void {}"],
] as const)("throws when dest exports %s", async ([, decl], { seedNamedFixture }) => {
  const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
  // ...
});
```

For a test that also tracks a spawned process (daemon integration tests), keep a describe-level `dirs`/`procs` array and populate `dirs` from the fixture's `dir` inside the test body; `afterEach` still kills processes and daemon files, but must not also remove `dir` — `fixtureTest`'s own teardown runs after `afterEach` and would throw ENOENT on an already-deleted path (this ordering — `afterEach` before fixture teardown — is stable current vitest behaviour, not documented API; if this doesn't hold in the future, `pnpm test:mutate:file src/__testHelpers__/fixtures/fixtures.ts` and this describe block's own tests will fail loudly on cleanup):

```ts
const dirs: string[] = [];
const procs: ChildProcess[] = [];

afterEach(() => {
  for (const proc of procs.splice(0)) if (!proc.killed) proc.kill();
  for (const dir of dirs.splice(0)) {
    killDaemon(dir);
    removeDaemonFiles(dir); // no cleanup(dir) — fixtureTest's dir fixture removes it after
  }
});

test("...", async ({ seedNamedFixture }) => {
  const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
  dirs.push(dir);
  // ...
});
```

Dynamic `await import()` calls inside test bodies break V8 coverage tracking — Stryker cannot associate those tests with the imported module's lines. Use static imports at the top of the file.

Prefer observing a property through behaviour over instrumenting the code to count what it did. A memo that never expires is visible as a stale answer; one that is cleared is visible as a fresh one — both testable against a real filesystem with no mocking, and both still meaningful after a refactor that a call-counter would not survive. Reserve `vi.mock` for side effects with no observable consequence. If a mock appears not to intercept anything, that is a signal to re-ask whether the property is observable, not to reach for `vi.resetModules()` and a dynamic re-import to force it.

## Type casts

Casts (`as X`) throw away what the type system knows. Reach for them only at true system boundaries (JSON parse, user input, `!` on API returns you've just guarded). Inside the codebase:

- **`as Base` on a specific class is a smell.** If you find yourself writing `fn as Node & { remove(): void }` for five concrete ts-morph classes, the fix is a union return type — each member already satisfies the intersection. The cast hides that.
- **`as T` to paper over `| undefined` is a smell.** When you cast away the `undefined`, ask: is there a narrower API call that returns `T` directly? (e.g. `decl.getVariableStatement()` instead of `decl.getParent().getParent() as Node`.) If not, use `!` with a comment explaining the invariant — don't widen.
- **`as unknown as T` means the types are wrong.** Fix the types, do not bypass them.

If you're tempted to add a cast during implementation, stop and read the return type of the API you're calling. The cast usually exists to avoid thinking about the real shape.

## Defensive code vs. dead branches

If you write a guard (null check, boundary check, type narrowing) and can't construct a realistic input that exercises the fail path, the guard is dead code. TypeScript already rules out the case — you're guarding against a ghost.

Mutation testing exposes these: a surviving mutant on a guard you "know" can't be hit is not "noise, untestable" — it's a signal that the branch should be removed. Restructure the code so the impossible case isn't representable. Examples:

- Replace position-comparison logic with identity comparison (`node === declStmt`) — no boundary conditions to guard.
- Replace `const x = arr[0]; if (!x) continue;` with `const [x] = arr; if (!x) continue;` when the array check and the index check are the same check.
- Prefer APIs that return narrower types over chained `getParent().getParent()` + cast.

If a surviving mutant genuinely cannot be killed because the branch is unreachable, delete the branch — don't document it.

**A direct test of a helper can hide that its branches are unreachable.** Called through its own entry point, a helper can be handed inputs its real callers never produce — so an unreachable branch looks covered, no mutant survives on it, and nothing flags it. The dead code surfaces only when the direct test is removed. That is a second reason to test at the altitude the system actually reaches the code from: coverage bought with impossible inputs is coverage of a path that does not exist.

## Imports

Default to static imports at the top of the file. Use `await import()` only when you can name the specific reason — and write that reason as a comment.

- **Legitimate reasons:** a genuinely optional peer dependency that may not be installed, breaking a real circular dependency, an ESM-only module loaded from a CJS context.
- **Not legitimate:** "the package is heavy," "we only sometimes call this."

Dynamic imports break Stryker's coverage attribution — the lines of the imported module are invisible to the mutation runner when the import is dynamic (this applies to test bodies too: `await import()` inside a test stops Stryker associating that test with the imported module's lines). Static imports are also the standard here — `await import()` without a comment is a bug.

## Dependencies

Pin exact versions in `package.json` — never `^` or `~` ranges. A range lets a compromised patch release auto-install on the next `pnpm install`, turning a single package takeover into a supply-chain attack across every consumer. All versions must be exact (`"1.2.3"`, not `"^1.2.3"`). Only add actively maintained packages — check for deprecation warnings first.

## Engineering judgment

Read the code before forming an opinion. Look at function bodies, indirection depth, and seam boundaries before defending test placement or code structure — don't defend a position you haven't verified by reading the source. Spot clean-code opportunities proactively (dead code, tests at the wrong level, unnecessary indirection, duplicated logic) and fix them in separate commits. Treat wasted compute (hour-long mutation runs, redundant CI cycles) as a cost worth investigating, not dismissing.

## Refactoring triggers

These are signals to pause and refactor before continuing:

- **New generic logic:** If the function you're writing isn't specific to the current feature (path manipulation, AST helpers, string formatting), it likely belongs in a shared utility.
- **Duplicated patterns:** If you see the same 3+ lines of logic in multiple places, extract to a shared function.
- **High branching complexity:** If a function has many conditional branches, check whether some branches duplicate logic that exists elsewhere or could be simplified by reusing existing helpers.
- **Excessive comments:** If a function or test needs many inline comments to be understood, the code is too complex — extract, rename, or decompose until the comments are unnecessary.
