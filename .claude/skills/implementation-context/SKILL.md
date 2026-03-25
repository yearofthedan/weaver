---
name: implementation-context
description: Use before writing code for an AC. Reads neighbouring code to absorb local patterns and find reusable code — so implementation fits the codebase, not just passes tests.
---

# Implementation Context

Run this before writing tests for each AC. The goal: understand how the *nearby code* does things so your implementation fits naturally.

This is a fast "look around before you type" step — not a planning phase. 2-3 minutes of reading, not 20.

## Steps

### 1. Read the neighbourhood (2-3 files)

Look at files that do similar things to what you're about to write:
- Same directory as your target file
- Same operation type (if adding a new operation, read 2 existing ones)
- The caller — the file your code will be called from

Read function bodies, not just signatures.

### 2. Extract local patterns

From those files, note the conventions you need to match:
- **Error handling** — `EngineError` with codes? Return objects? Early returns?
- **Naming** — how are variables, functions, and test descriptions phrased?
- **Imports** — barrel imports? Direct file imports? Type-only imports?
- **Test structure** — fixture setup style, assertion style, what's mocked vs real?
- **Missing-input handling** — what do similar functions do when input is absent or invalid?

### 3. Check for reusable code

Before writing anything new, search for:
- Existing utilities (`src/utils/`, barrel exports)
- Existing test helpers (`__testHelpers__/`, `__helpers__/`)
- Existing error codes and types (`src/utils/errors.ts`, `src/operations/types.ts`)

Use what exists. Extend what almost exists. Only create when nothing fits.

### 4. Write to agent notes

In your agent notes file, record:
- Which files you read and what patterns you'll follow
- What existing code you'll reuse
- Anything the neighbourhood handles that your AC doesn't mention but probably should (e.g. every similar operation validates input — yours should too)

If something in the neighbourhood contradicts the AC or the dispatch brief, note it and match the codebase — the code that's already there and working wins over a brief that may not have seen it. Flag the deviation in your notes so the orchestrator knows.

## When to stop and report back

- The AC requires infrastructure that doesn't exist and isn't trivial to add
- You found a bug in existing code that your AC would build on top of
- The neighbourhood reveals the AC's approach won't work (e.g. the integration point doesn't support the assumed interface)
