# Code Standards

Project-wide coding standards. Referenced by agents, skills, and CLAUDE.md.

These checks happen **before** implementing, not after. Read the target files, assess their size and complexity, and decide whether extraction or refactoring is needed before adding new code. This is cheaper and cleaner than untangling changes after the fact.

## File size

- **Ideal:** 150 lines or fewer. Small files are easy to test, review, and mutate.
- **Review at 300:** Pause and consider whether the file has multiple responsibilities or contains logic that belongs in a utility.
- **Hard flag at 500:** The file almost certainly needs decomposition. Do not extend it without extracting first.

Large files make mutation testing expensive — more mutants per file means longer runs and harder triage.

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

**Test-specific:**

- Do not add comments like `// Verify X` or `// Check that Y` above assertions. The assertion *is* the verification. If the intent is unclear, improve the test structure: use descriptive `it()` names, extract setup into named helpers, or use custom matchers.
- Group related assertions naturally with blank lines rather than comment headers.

## Tests

### Quality model

Line count is one smell detector among several. A short test file can still be unhealthy. Assess test health on these dimensions:

- **Layer fit.** Is each test at the lowest layer that can verify the behaviour? Pure logic belongs at the unit layer with in-memory dependencies. Integration tests verify wiring, not exhaustive input variations.
- **Setup proportionality.** Is the setup proportional to what's being verified? When the fixture ceremony dwarfs the assertion, the logic under test likely belongs behind a seam that can be tested with lighter dependencies.
- **Coverage directness.** Is the behaviour asserted through a direct call, or indirectly through a chain of collaborators? Indirect coverage is fragile — a change to an unrelated collaborator can silently break the path that exercises the real logic.
- **Mutation resilience.** Would a logic inversion in the code under test be caught? Assertions must pin exact output shapes and cover at least one boundary. TypeScript types don't kill mutants — only assertions do.
- **Assertion clarity.** Are assertions inline and direct, or hidden behind helpers that obscure what's being checked? Indirection in assertions makes test failures harder to diagnose. Prefer inline assertions with clear variable names over extracted assertion helpers.

### Source extraction = test review

Extracting a new entity (service, utility, domain object) changes the testing surface. The test suite must be reviewed in the same pass — not as a follow-up, not as a separate task. If the source moved, the tests move with it.

- Unit tests for the extracted entity using the lightest dependencies that exercise the logic
- Integration tests thinned to orchestration only — edge cases that the unit layer now covers directly are removed from the integration layer
- No assertion weakened — every previously-asserted behaviour is still asserted somewhere

### Refactoring hierarchy

The same file-size thresholds apply to test files. A large test file is usually a symptom — diagnose the cause before splitting. Work top to bottom:

1. **Push integration tests down.** If an integration test is large because it exercises lots of internal logic, extract that logic into units with their own tests. Keep the integration test narrow — it should verify the integration point, not re-test the units.
2. **Decompose the source.** If a unit test is large because the unit under test is complex, the source itself probably needs decomposition. Split the source; tests follow naturally.
3. **Extract shared fixtures and setup.** Repeated project scaffolding (`mkdirSync`, `writeFileSync`, tsconfig boilerplate) belongs in shared helpers. Co-locate in `tests/helpers/` or a `__helpers__` file next to the tests.
4. **Use parameterised tests.** When multiple cases test the same behaviour with different inputs, use `it.each` / `describe.each` rather than duplicating test bodies.
5. **Split by feature area (last resort).** If the above steps aren't enough, split the file along feature boundaries. This is a last resort because it can obscure which tests cover which code paths.

### Colocate test helpers with their domain

Test doubles belong near the concept they mock, not in a generic folder. `makeMockCompiler` mocks the `Compiler` interface — it belongs in `tests/compilers/__helpers__/`, not `tests/helpers/`. Use `__helpers__/` subfolders per domain area.

### Test layer must match code layer

Tests follow their subject. A test for an operation lives in the operation's test file; a test for an engine method lives in the engine's test file. If a test colocated with one subject is exercising another subject's logic indirectly, push it down to the right file.

Size doesn't override this. When a test file approaches the 300-line review threshold, that triggers assessment via the refactoring hierarchy above — not a new test file as a workaround. A new test file is only justified after the hierarchy has been applied and the file still warrants splitting along feature boundaries.

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

## Refactoring triggers

These are signals to pause and refactor before continuing:

- **New generic logic:** If the function you're writing isn't specific to the current feature (path manipulation, AST helpers, string formatting), it likely belongs in a shared utility.
- **Duplicated patterns:** If you see the same 3+ lines of logic in multiple places, extract to a shared function.
- **High branching complexity:** If a function has many conditional branches, check whether some branches duplicate logic that exists elsewhere or could be simplified by reusing existing helpers.
- **Excessive comments:** If a function or test needs many inline comments to be understood, the code is too complex — extract, rename, or decompose until the comments are unnecessary.
