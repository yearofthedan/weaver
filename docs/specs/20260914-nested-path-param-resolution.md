# Nested path params resolve against the daemon's cwd

**type:** bug
**date:** 2026-09-14
**tracks:** handoff.md # a scenario step cannot use surgical `replaceText`

---

## Symptom

A surgical `replaceText` whose `edits[].file` is workspace-relative resolves that path against the **daemon process's working directory**, not the request's workspace. The caller controls the workspace and cannot see the daemon's cwd, so the same request writes a different file depending on where the daemon happened to be spawned — and reports success either way.

Every other path parameter in the API is resolved against the workspace and boundary-checked before the operation runs. `edits[].file` sits inside an array, and both path-param tables list only top-level keys, so it reaches neither step.

## Value / Effort

- **Value:** A write operation can land on a file the caller did not name. The reported reproduction is the benign half (an error on a path that is genuinely inside the workspace); the other half writes the wrong file and returns `status: success`, with `oldText` verification as the only accidental guard. The exposure is a hand-written or agent-composed edit list; `search-text` returns absolute paths, so feeding search results straight to `replace-text` avoids it. Secondary: the scenario format cannot express a surgical `replaceText` step at all, which is why `replace-text` has no scenario coverage and why the Vue post-write check has no end-to-end test available to it.
- **Effort:** Localised. One utility gains array descent, two declaration tables gain a row, one dispatcher loop widens to the paths those rows name, and one `path.resolve` in the operation gains its missing base. Every change sits in a module that already exists.

```
input:    replaceText { edits: [{ file: "src/lib.ts", line: 1, col: 18,
                                  oldText: "MARKER", newText: "1" }] }
          workspace = <root>;  daemon cwd = <root>/sub
          (<root>/src/lib.ts and <root>/sub/src/lib.ts both exist, same content)
actual:   status: success, filesModified: ["<root>/sub/src/lib.ts"]
          <root>/src/lib.ts unchanged — the file the caller named was never touched
expected: status: success, filesModified: ["<root>/src/lib.ts"]

input:    the same request with daemon cwd outside the workspace
actual:   status: error, WORKSPACE_VIOLATION — "file is outside the workspace: src/lib.ts"
expected: status: success, filesModified: ["<root>/src/lib.ts"]
```

## Expected

A workspace-relative `edits[].file` behaves exactly like a relative `file` on any other operation:

- `replaceText { edits: [{ file: "src/lib.ts", … }] }` with workspace `<root>` writes `<root>/src/lib.ts`, whatever the daemon's cwd is, and reports that absolute path in `filesModified`.
- `edits: [{ file: "../outside.ts", … }]` is rejected `WORKSPACE_VIOLATION` by the dispatcher, before the operation runs.
- `edits: [{ file: "src/a\u0000.ts", … }]` is rejected `INVALID_PATH` by the dispatcher, same as a flat path param.
- An absolute `edits[].file` is unaffected.

## Root cause

Confirmed by reproduction (probe output in Value / Effort above; the cwd was moved between two runs of one request).

Three places, one missing declaration:

1. `src/operations/replaceText.ts:120` and `:135` — `applySurgicalEdits` calls `path.resolve(edit.file)` with no base, so a relative path resolves against `process.cwd()`. In the daemon that is wherever the daemon was spawned.
2. `src/daemon/dispatcher.ts:253` and `src/adapters/cli/operations.ts:76` — `replaceText`/`replace-text` declare `pathParams: []`, so `edits[].file` is invisible to both consumers of the declaration.
3. `src/utils/resolve-path-params.ts:12-17` — `resolveRelativePaths` reads `params[key]` and tests `typeof val === "string"`, so it could not descend into an array even if the declaration named one.

The empty declaration also suppresses validation: the dispatcher's validation loop (`dispatcher.ts:361-385`) iterates the same declaration, so `edits[].file` never reaches `validateFilePath` or the workspace check. The rejection in the failing case comes from the operation's own guard (`replaceText.ts:121`) — after cwd resolution has already decided which file the path means.

## Fix

1. **`src/utils/resolve-path-params.ts`** — accept a nested declaration of the form `"edits[].file"`: read the named array from `params`, and for each element resolve the named key when it is a relative string. Flat declarations keep their current behaviour byte for byte. A missing or empty array is a no-op, not a throw.
2. **`src/daemon/dispatcher.ts`** — declare `pathParams: ["edits[].file"]` on `replaceText`, and widen the validation loop so it validates every path the declaration names, nested included: `validateFilePath` then `WorkspaceScope.contains`, producing today's `INVALID_PATH` / `WORKSPACE_VIOLATION` responses.
3. **`src/adapters/cli/operations.ts`** — the same declaration on `replace-text`, so the CLI resolves relative nested paths against `--workspace` before the request leaves the process.
4. **`src/operations/replaceText.ts`** — `applySurgicalEdits` resolves against the scope it was handed (`path.resolve(scope.root, edit.file)`) rather than the ambient cwd, at both `:120` and `:135`. After (2) the paths arriving from the dispatcher are already absolute, so this is about the direct caller: a test or future in-process caller must not be able to reach the cwd-dependent behaviour.

**Engine selection must not read the nested row.** `dispatcher.ts:406-409` indexes `descriptor.pathParams[0]` to pick the file that engine discovery walks up from. `replaceText` currently has no rows and so selects with `undefined`; adding a nested row must not turn that into a lookup of the literal key `"edits[].file"` (which yields `undefined` typed as a string). Keep engine selection on top-level rows only.

**Adjacent inputs** — regression coverage for each:

- absolute `edits[].file` — unchanged behaviour
- one request mixing absolute and relative edit paths
- two relative edits naming the same file — grouping still collapses them to one write
- `edits: []` — no-op, no throw from the descent
- relative path escaping the workspace (`../outside.ts`) — `WORKSPACE_VIOLATION` from the dispatcher
- relative path with a control character or URI fragment — `INVALID_PATH` from the dispatcher
- relative path naming a sensitive file (`.env`) — `SENSITIVE_FILE`, unchanged
- every other operation, which declares only flat rows — unchanged
- the CLI path (`weaver replace-text '{"edits":[…]}'` with relative paths), which is the second consumer of the declaration

**Layer-fit:**

| Unit of verification | Layer |
|---|---|
| nested descent, flat behaviour preserved, empty/missing array | unit — `src/utils/resolve-path-params.test.ts` (46 lines, room to extend) |
| `INVALID_PATH` / `WORKSPACE_VIOLATION` on a nested path | dispatcher unit — `src/daemon/dispatcher.test.ts` |
| the write lands on the workspace-relative file, not a cwd-relative one | scenario — new `src/operations/replaceText.scenarios.yaml` (first scenario file for the operation; its absence is the entry this spec closes) |
| CLI resolves relative nested paths against `--workspace` | one CLI smoke, beside the existing CLI integration tests |

## Security

- **Workspace boundary:** Strictly strengthened. `edits[].file` moves from "validated by the operation after cwd resolution" to "validated by the dispatcher against the request's workspace", the same route every other path takes. The resolution base moves from an ambient process property to the request's own workspace, which removes the case where a path inside the workspace is interpreted as a path somewhere else.
- **Sensitive file exposure:** Unchanged. `isSensitiveFile` still runs in `applySurgicalEdits` over the resolved path; it now runs over a path resolved against the workspace, so a relative `.env` is classified against the right file.
- **Input injection:** `edits[].file` now reaches `validateFilePath` before the filesystem, so control characters and URI fragments are rejected rather than passed to `path.resolve`.
- **Response leakage:** The response keeps its fields; `filesModified` carries absolute paths and will now carry the correct ones.

## Edges

- The declaration syntax stays data: a string in the two existing tables. `edits[].file` is the only nested path in the schema today; nothing else gains a row.
- `pathParamsFor` is read by the scenario runner (`scenario-runner.ts:79`), which passes the list straight to `resolveRelativePaths` — so the runner needs no change once the utility understands the syntax. Confirm that holds rather than assuming it.
- `readTree` in the scenario runner walks with `fs.readdirSync(recursive)` and no skip list, so a scenario can assert on files under `dist/` — this is what makes the spec that follows testable.
- Mutation scope: `src/utils/**` is Tier 1 in `stryker.config.mjs`, so `resolve-path-params.ts` is measured by the default `pnpm test:mutate`. `dispatcher.ts`, `replaceText.ts` and `cli/operations.ts` are all commented out of the `mutate` array, so their changed lines need explicit `pnpm test:mutate:file` runs — a green default run is not evidence they were measured.

## Done-when

- [ ] Reproduction case now produces expected output — the literal probe: one request, daemon cwd at `<workspace>/sub`, writes `<workspace>/src/lib.ts` and leaves `<workspace>/sub/src/lib.ts` untouched
- [ ] Regression test covers the exact failing case, plus every adjacent input listed above
- [ ] Mutation score ≥ threshold for touched files (`pnpm test:mutate` covers `resolve-path-params.ts`; explicit `test:mutate:file` runs for `dispatcher.ts`, `replaceText.ts`, `cli/operations.ts`)
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `/review-changes` run over the whole change and its findings applied — a green `pnpm check` does not stand in for it
- [ ] Docs updated: `docs/commands/replace-text.md` states the path contract for `edits[].file` (relative resolves against the workspace); `docs/internals/replace-text.md` if it describes path handling; `.claude/skills/weaver-search-and-replace/SKILL.md` if it tells agents to pass absolute paths
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` doc
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
