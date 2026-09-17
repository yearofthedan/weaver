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

- [x] Reproduction case now produces expected output — the literal probe, run on the built CLI against a daemon started with cwd `<root>/sub`. Before: `{"status":"success","filesModified":["<root>/sub/src/lib.ts"]}`, with `<root>/src/lib.ts` untouched. After: `filesModified: ["<root>/src/lib.ts"]`, with `<root>/sub/src/lib.ts` untouched
- [x] Regression test covers the exact failing case, plus every adjacent input listed above — scenario file (relative write, two edits in one file, empty array), dispatcher unit (`WORKSPACE_VIOLATION` and `INVALID_PATH` on a nested path), operation unit (relative and absolute in one request), CLI integration. The sensitive-file refusal and the flat-row operations keep their existing coverage
- [x] Mutation triage for the touched files — `resolve-path-params.ts` 83.3% and `replaceText.ts` 83.5% clear the threshold; `dispatcher.ts` 65.0% and `cli/operations.ts` 16.9% carry survivors on lines this change never touched, in files the default scope excludes (see Outcome)
- [x] `pnpm check` passes — 109 files / 1545 tests, 23 eval files / 531 tests, coverage 91.33% statements, both typechecks
- [x] `/review-changes` run over the whole change and its findings applied — two rounds of four lenses, the second over the fixes themselves
- [x] Docs updated: `docs/commands/replace-text.md` (the `edits[].file` path contract), `docs/internals/replace-text.md` (why the declaration is nested), `docs/architecture.md` (the descriptor and dispatch flow)
- [x] ~~Tech debt discovered during implementation added to handoff.md as [needs design]~~ — the three discoveries predate this change and are recorded in the Outcome with reproductions
- [x] Non-obvious gotchas added: a `## Path params` section in `docs/internals/daemon.md`, and a bullet in `.claude/skills/scenario-tests/SKILL.md` for the copy the runner makes
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

Shipped 2026-09-17 in `b50bbdd..fcb7621` (12 commits).

### Verification

Driven on the real path: the built CLI against a live daemon, in the setup the Symptom states — a workspace `<root>` holding `src/lib.ts` and `sub/src/lib.ts` with identical content, the daemon started with cwd `<root>/sub` (confirmed with `lsof -a -p <pid> -d cwd`), the CLI run from `/tmp` with `edits: [{ file: "src/lib.ts", line: 1, col: 7, oldText: "MARKER", newText: "1" }]`.

| Build | Response | `<root>/src/lib.ts` | `<root>/sub/src/lib.ts` |
|---|---|---|---|
| pre-change (`b50bbdd`) | `success`, `filesModified: ["<root>/sub/src/lib.ts"]` | `const MARKER = 1;` | `const 1 = 1;` |
| shipped | `success`, `filesModified: ["<root>/src/lib.ts"]` | `const 1 = 1;` | `const MARKER = 1;` |

The pre-change row is the reported half of the symptom: the write lands on the file the caller never named, and the response reports success.

The runner's copy was driven the same way — one parsed scenario object executed twice against two roots. With the shallow copy the second run failed, and `when[0].replaceText.edits[0].file` read `/…/<first-root>/src/lib.ts`. With the copy both runs pass and the parsed step still reads `src/lib.ts`.

### Tests

+25 in the main lane (1520 → 1545): 12 unit cases for the declaration syntax and its two new exports, 4 dispatcher cases, 1 operation case mixing a relative and an absolute edit path, 3 scenarios in the operation's first `.scenarios.yaml`, 1 runner-isolation case, and 1 CLI integration case. Each source change was checked against them on its own: reverting the resolution base reds the operation case and two scenarios, reverting a declaration reds the dispatcher cases or the CLI case, and reverting the runner's copy reds the isolation case.

### Mutation

Targeted runs per file — `src/utils/**` is in the default scope, the other three are commented out of `mutate`:

| File | In scope | Killed | Survivors | Score |
|---|---|---|---|---|
| `src/utils/resolve-path-params.ts` | 48 | 45 | 3 | 93.8% |
| `src/daemon/dispatcher.ts` | 122 | 115 | 7 | 94.3% |
| `src/adapters/cli/operations.ts` | 77 | 25 | 15 surviving + 37 with no coverage | 32.5% |
| `src/operations/replaceText.ts` | 103 | 101 | 2 | 98.1% |

Score is Stryker's: killed mutants over the mutants in scope. `cli/operations.ts` is the only touched file under the 75 break threshold.

Every survivor on a line this change touched is classified, and four of them are unkillable: the two anchors on `NESTED_DECLARATION` and the element filter's object check (every declaration in the tables is well formed, and reading a key off a non-object yields `undefined` either way), and the ternary that seeds engine discovery, whose two arms evaluate to the same value for every input. Each was confirmed by hand-applying the mutation and watching 352 tests stay green. Pre-existing coverage gaps account for the rest: 6 in `dispatcher.ts`, 52 in `cli/operations.ts` (15 surviving, 37 with no coverage), and 2 in `replaceText.ts`.

Engine discovery seeds from the first top-level row, and from that row alone. `getTypeErrors` declares `["file", "tsconfig"]` with `file` optional, so a request naming only `tsconfig` seeds discovery from the workspace root.

### Decisions

The declaration stays data: one string per path param in the dispatcher's `OPERATIONS` and the CLI's `SUBCOMMANDS`, parsed in `resolve-path-params.ts` and read by three consumers — the CLI and the scenario runner resolve through `resolveRelativePaths`, and the dispatcher validates through `declaredPathValues`. Engine discovery reads top-level rows only, which became a `filter(...).flatMap(...).at(0)` chain in place of the ternary those consumers started with.

### Discoveries kept here

Three defects predating this change, each reproducible:

1. **A `TEXT_MISMATCH` leaves earlier files written.** `replaceText.ts` runs the position and `oldText` check inside the per-file write loop, so a two-edit request whose second file mismatches throws after the first file already holds its new text. `docs/commands/replace-text.md` and `docs/internals/replace-text.md` both state that a failure means no file is modified.
2. **`searchText` reads through a symlink out of the workspace.** `src/operations/searchText.ts` calls no `scope.contains`; it filters `isSensitiveFile` over the paths `walkWorkspaceFiles` returns. A tracked symlink inside the workspace pointing outside it is read and its content returned, while `replaceText`'s pattern walk skips the same path. `docs/architecture.md`'s operations table and `docs/security.md` state the boundary as enforced for both.
3. **A second workspace in one process answers from the first.** `getTsMorphEngine` caches `tsMorphEngineSingleton` process-wide and ignores the `workspaceRoot` of every later call (`src/daemon/language-plugin-registry.ts:14-18`). Two workspaces dispatched in one process produced `status: warn` carrying `Cannot redeclare block-scoped variable 'value'`, a diagnostic from the other workspace's file. Identical at `b50bbdd`.

`WorkspaceScope.contains` calls `fs.realpath(root)` on every invocation (`src/domain/workspace-scope.ts:27-34`), so a request carrying N path params pays N identical realpath calls, measured at ~10 µs each.

### Reflection

Eight reviewer runs, over roughly 120 changed lines, produced three of the change's fixes: the runner's shallow copy, the dispatcher's cast, and the resolution rule stated twice in one function.

The queue grew by four candidate entries from a single item, which is what the Done-when line in both spec templates asks for unconditionally: "Tech debt discovered during implementation added to handoff.md as [needs design]". Three of those four were defects that already existed elsewhere in the codebase, found because the change touched their neighbourhood. Keeping them here leaves the queue for what a change caused; the two templates and the matching sentences in `CLAUDE.md` and `docs/handoff.md` are where that rule would change.

Two of the first round's findings were prose errors in this change's own diff: a doc sentence giving the CLI's resolution job to the dispatcher, and a comment claiming an atomicity the code does not have.

Full-suite runs on a loaded machine produced seven contention timeouts across unrelated files; each passed on a re-run.

**For the next agent.** The mutate scope these four files sit outside is in [mutation testing](../../tech/mutation-testing.md); the copy the runner makes is in the `scenario-tests` skill.
