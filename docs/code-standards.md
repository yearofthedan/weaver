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

## Refactoring triggers

These are signals to pause and refactor before continuing:

- **File over threshold:** If your target file is already near 300 lines, extract before adding more code. Don't make a smell worse.
- **New generic logic:** If the function you're writing isn't specific to the current feature (path manipulation, AST helpers, string formatting), it likely belongs in a shared utility.
- **Duplicated patterns:** If you see the same 3+ lines of logic in multiple places, extract to a shared function.
- **High branching complexity:** If a function has many conditional branches, check whether some branches duplicate logic that exists elsewhere or could be simplified by reusing existing helpers.
- **Excessive comments:** If a function or test needs many inline comments to be understood, the code is too complex — extract, rename, or decompose until the comments are unnecessary.

## When to apply

These checks happen **before** implementing, not after. Read the target files, assess their size and complexity, and decide whether extraction or refactoring is needed before adding new code. This is cheaper and cleaner than untangling changes after the fact.
