---
name: scenario-tests
description: Use when adding, changing, or deleting tests for an operation's observable behaviour — what a caller receives and what happens to the workspace. Covers the YAML scenario format, when a focused test is the right layer instead, and what justifies deleting a test in favour of a scenario.
metadata:
  internal: true
---

# Scenario tests

Declarative cases in `src/operations/<operation>.scenarios.yaml`, run through the daemon dispatcher by the shared runner in `src/__testHelpers__/scenarios/`. One vitest file per operation loads the YAML and runs each case.

The format exists to remove one authoring mistake. A hand-written test picks its own assertion, and `toContain("utils/useCounter")` looks reasonable while passing against a specifier that gained a `.js` and now names a different module. The runner compares whole file content and the whole response because it has no way to do less.

## The shape

```yaml
fixtures:
  a-utils-module:
    description: an exported utility at src/utils.ts, with no importers of its own
    files:
      tsconfig.json: '{ "include": ["src"] }'
      src/utils.ts: export const one = 1;

scenarios:
  - name: moves a file and repoints every importer
    description: why the expectation below is what it is — optional, shown on failure
    given: a-utils-module          # a fixture name, or an inline body with the same keys
    when:
      - moveFile: { oldPath: src/utils.ts, newPath: lib/utils.ts }
    then:
      response:
        status: success
        filesModified: [lib/utils.ts]
        typeErrors: none           # sugar: expands to the three fields a clean check returns
      files:
        moved:
          src/utils.ts: lib/utils.ts
        unchanged: [tsconfig.json]
```

`given` accepts a fixture name or an inline body; `extends` chains one onto another, later layers overwriting earlier. A permutation scenario — where the tsconfig *is* the subject — should inline its whole project rather than reach for a named fixture.

`moved` takes a destination string when the file arrives byte-identical, or `{ to, content }` when the move rewrites the file's own imports on the way.

## Two contracts, both total

- **`then.response`** is compared by deep equality, so a renamed, dropped, added or retyped field fails here. Paths are workspace-relative; the runner scrubs the temp root before comparing.
- **`then.files`** must account for every file that changed. `unchanged` is not bookkeeping — it names a file the operation was *right* to leave alone, so the non-change reads as the point of the case. A file that changed without being named fails.

A single-step scenario **must** state a response; a multi-step scenario **must not**. A top-level response on a sequence could only approve the last call, leaving the earlier ones unasserted while looking total — so sequences assert net file effects instead, and the runner requires every step to have succeeded.

## Choosing the layer

Write a scenario for observable behaviour. Keep a focused test when the case needs an input the format refuses to build — the current examples are a symlinked workspace root, a git index holding a path a prior move deleted, a file written between project load and the call, and a direct engine call with no operation around it.

Also keep a focused test when the format *can* build the input but only at a cost that buries what the case is for: eleven near-identical fixture files to prove a ten-item cap say less than a loop that writes eleven importers. The test still goes through `dispatchRequest` — only the setup moves into code, so the layer is unchanged.

**Mutation parity is not a deletion criterion.** Those focused tests read as redundant because their mutants die to other tests. They are still the only place those inputs exist. Delete a test because a named scenario now covers the same input, not because the score held.

When retiring tests in favour of scenarios:

1. Map each test to the scenario replacing it, one by one. A test with no mapping stays.
2. Record the mutation score over the operation's call graph **before** deleting anything — it cannot be recovered afterwards.
3. Re-run it after as a backstop, and account for every mutant that was killed before and survives now.

Note that `src/ts-engine/**` and `src/operations/**` are commented out of `mutate` in `stryker.config.mjs`, and `src/**/__testHelpers__/**` is excluded outright. A green `pnpm check` measures none of this; the run has to be explicit (`--mutate <files> --force`, with `--incrementalFile` pointed somewhere scratch so the tracked cache is not overwritten by a partial run).

## Gotchas

- **The runner resolves only the params a method declares as paths.** `pathParamsFor` in the dispatcher is the source of truth, shared with the CLI, so a method taking a literal string — a search pattern, a symbol name — receives it unjoined. Adding or removing a path param in a method's `OPERATIONS` entry changes what its scenarios resolve.
- **A scenario's `description` reaches a failure message, nothing else.** Use it to say why the expectation is what it is — most valuable on a case pinning behaviour known to be wrong, where the expected content looks like a bug and the next reader needs to know it is deliberate.
