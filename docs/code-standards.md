# Code Standards

Project-wide coding standards. Referenced by agents, skills, and CLAUDE.md.

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

Audit every test file: does its test target match the directory it lives in? A test in `tests/operations/` should call the operation function; a test in `tests/compilers/` should call the compiler method directly. If a test in `tests/operations/` is exercising compiler logic through the operation, it belongs in `tests/compilers/`. "Stays as-is" requires justification, not just inertia.

### Avoid

- Extracting assertion helpers that hide what's being checked. Indirection in assertions makes test failures harder to diagnose. Prefer inline assertions with clear variable names.

## Refactoring triggers

These are signals to pause and refactor before continuing:

- **File over threshold:** If your target file is already near 300 lines, extract before adding more code. Don't make a smell worse.
- **New generic logic:** If the function you're writing isn't specific to the current feature (path manipulation, AST helpers, string formatting), it likely belongs in a shared utility.
- **Duplicated patterns:** If you see the same 3+ lines of logic in multiple places, extract to a shared function.
- **High branching complexity:** If a function has many conditional branches, check whether some branches duplicate logic that exists elsewhere or could be simplified by reusing existing helpers.
- **Excessive comments:** If a function or test needs many inline comments to be understood, the code is too complex — extract, rename, or decompose until the comments are unnecessary.

## When to apply

These checks happen **before** implementing, not after. Read the target files, assess their size and complexity, and decide whether extraction or refactoring is needed before adding new code. This is cheaper and cleaner than untangling changes after the fact.
