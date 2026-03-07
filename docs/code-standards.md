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

## Refactoring triggers

These are signals to pause and refactor before continuing:

- **File over threshold:** If your target file is already near 300 lines, extract before adding more code. Don't make a smell worse.
- **New generic logic:** If the function you're writing isn't specific to the current feature (path manipulation, AST helpers, string formatting), it likely belongs in a shared utility.
- **Duplicated patterns:** If you see the same 3+ lines of logic in multiple places, extract to a shared function.
- **High branching complexity:** If a function has many conditional branches, check whether some branches duplicate logic that exists elsewhere or could be simplified by reusing existing helpers.

## When to apply

These checks happen **before** implementing, not after. Read the target files, assess their size and complexity, and decide whether extraction or refactoring is needed before adding new code. This is cheaper and cleaner than untangling changes after the fact.
