# Total dispatch response

**type:** change
**date:** 2026-08-23
**tracks:** handoff.md # `dispatchRequest` is not total, so the response contract has two producers → docs/reference/response-format.md, docs/internals/daemon.md

---

## Context

`dispatchRequest` returns error responses for `UNKNOWN_METHOD`, `VALIDATION_ERROR`, `INVALID_PATH` and `WORKSPACE_VIOLATION`, but has no try/catch around `descriptor.invoke`. Anything an operation throws — 40 `throw new EngineError` sites across `src/` — propagates out and is shaped into `{status, error, message}` by the socket handler in `daemon.ts` instead. So `status` is decided in two places, the `EngineError`-to-response mapping sits beside JSON parsing and socket writes, `dispatchRequest` is typed `Promise<object>`, and the error contract is reachable only through a live socket — which is why nothing tests it.

## User intent

*As a developer using weaver, I want a failed refactor to come back as a predictable, documented error response — and a crash to come back with enough detail to report in one shot — so that I can branch on failures reliably instead of discovering that an untested error path returns something else.*

## Relevant files

- `src/daemon/dispatcher.ts` — `dispatchRequest` and the `OPERATIONS` table; gains the catch boundary and the return type
- `src/daemon/daemon.ts` — `handleSocketRequest`; loses the `EngineError` mapping, keeps `PARSE_ERROR`
- `src/domain/errors.ts` — `EngineError` and the `ErrorCode` union that types the error arm
- `src/daemon/logger.ts` — `LogEntry.stack` and `stripWorkspacePrefix`; the latter moves out
- `src/adapters/cli/operations.ts:144` — the CLI consumer, which branches on `status === "error"` through a cast
- `src/daemon/dispatcher.test.ts` — where the newly-reachable error contract gets tested
- `src/daemon/daemon.integration.test.ts:169-198` — the existing `PARSE_ERROR` coverage that must keep passing
- `docs/reference/response-format.md` — the documented wire contract

### Red flags

- **`src/daemon/dispatcher.test.ts` is 478 lines.** Code standards flag mixed responsibilities as common around 300 and near-certain over 500; the new error-contract tests push it over. Push-down isn't available — these tests exercise dispatcher wiring, not logic that lives elsewhere — so split by area. **Prep step: move the `dispatchRequest getTypeErrors engine routing in a Vue project` block (lines 323–430) to its own file before adding tests.** It is the most self-contained area and is about engine selection, not the dispatch contract.
- **`src/daemon/daemon.integration.test.ts:187` is mistitled.** It reads `"returns PARSE_ERROR for invalid JSON (SyntaxError) and INTERNAL_ERROR for other unexpected errors"` but the body only asserts `PARSE_ERROR`. Nothing tests `INTERNAL_ERROR` anywhere. Correct the title to what it asserts.

**Layer-fit:** ACs 1–4 and 6 are pure functions of their inputs — unit layer, no socket. AC 5 is the one wiring path that needs a live daemon: one smoke test.

## Value / Effort

- **Value:** The error response is what an agent branches on when a refactor fails. Today no test of any kind can assert it without standing up a live socket, so the absence of reported defects is an artefact of the structure rather than evidence of health — a wrong error code ships silently. Making the dispatcher total puts every failure response behind a unit test. Separately, a developer who hits a weaver bug can currently hand the maintainer only an error code and a message; `--verbose` doesn't help because it is a daemon flag, off by default, that must be set *before* the crash. Attaching frames to `INTERNAL_ERROR` turns a reproduce-with-a-flag round trip into a single paste.
- **Effort:** Two source files modified (`dispatcher.ts`, `daemon.ts`), one small new module (`serialise-response.ts`), one edit to move `stripWorkspacePrefix` out of `logger.ts`, plus the test-file split. No new infrastructure — the catch boundary is plumbing through an existing pattern.

## Behaviour

- [ ] **An operation's thrown `EngineError` becomes a returned response.** Given `dispatchRequest({ method: "getTypeErrors", params: { file: "<workspace>/does-not-exist.ts" } }, workspace)`, the promise **resolves** to `{ status: "error", error: "FILE_NOT_FOUND", message: "File not found: <workspace>/does-not-exist.ts" }` with no `stack` field. It does not reject. (`getTypeErrors` has `pathParams: []`, so no boundary pre-check intercepts it.)

- [ ] **An unexpected throw becomes `INTERNAL_ERROR` with a stack.** Given an operation that throws a non-`EngineError` — a `TypeError` with message `"boom"`, induced by stubbing the operation module — `dispatchRequest({ method: "moveFile", … })` resolves to `{ status: "error", error: "INTERNAL_ERROR", message: "TypeError during 'moveFile': boom", stack: <frame lines> }`.

- [ ] **The stack is frames only, workspace-stripped, and capped.** Given a thrown `Error` whose `stack` is `"TypeError: boom"` followed by 15 frame lines, three of which contain `<workspace>/src/`, the returned `stack` contains no `"TypeError: boom"` line, contains at most 10 frames, and contains no occurrence of the workspace prefix.

- [ ] **A thrown non-`Error` still produces a valid response.** Given an operation that throws the string `"boom"`, `dispatchRequest` resolves to `{ status: "error", error: "INTERNAL_ERROR", message: "boom" }` with no `stack` field.

- [ ] **The socket still produces the same contract.** Against a live daemon, `getTypeErrors` on a missing file returns `{ status: "error", error: "FILE_NOT_FOUND" }` over the socket. (Regression guard: the transport change must not alter what an agent sees.)

- [ ] **A response that cannot be serialised still yields a response.** Given a `DispatchResponse` containing a circular reference, `serialiseResponse` returns `{"status":"error","error":"INTERNAL_ERROR","message":"response could not be serialised"}\n` rather than throwing. Given any ordinary response, it returns that response's JSON followed by a newline.

## Structural criteria

- [ ] `dispatchRequest` is declared `Promise<DispatchResponse>`, not `Promise<object>`.
- [ ] `dispatcher.ts` exports `DispatchResponse`, discriminated on `status`.
- [ ] `daemon.ts` does not import `EngineError`.
- [ ] `stripWorkspacePrefix` is no longer exported from `logger.ts` — it becomes a **private** function inside `dispatcher.ts`, its only remaining caller. Its three unit tests in `logger.test.ts` are deleted, not relocated: keeping the export so a test can reach it directly is the export-for-tests-only smell in `docs/design-principles.md`, and the stripping is asserted through `dispatchRequest`'s return value instead.

## Interface

```ts
export type DispatchError = {
  status: "error";
  error: ErrorCode;
  message: string;
  /** Frame lines only, present exclusively on INTERNAL_ERROR. */
  stack?: string;
};

export type DispatchResponse =
  | ({ status: "success" | "warn" } & Record<string, unknown>)
  | DispatchError;

export async function dispatchRequest(
  req: { method: string; params: Record<string, unknown> },
  workspace: string,
): Promise<DispatchResponse>;
```

The success arm stays loose deliberately. `OPERATIONS` is a heterogeneous table of twelve differently-shaped results; typing the union would mean making `OperationDescriptor.invoke` generic, which is a far larger change for no present force. The part that is duplicated today is the error arm, and that gets a real type.

**`status`** — `"success"`, `"warn"`, or `"error"`. Computed in exactly one place. Unchanged semantics: `warn` when `typeErrorCount > 0`.

**`error`** — an `ErrorCode` from `src/domain/errors.ts`. 19 possible values. Never absent on the error arm.

**`message`** — human-readable. For `EngineError` it is `err.message` verbatim, preserving today's wording and the existing tests that assert on it. For `INTERNAL_ERROR` it is `` `${err.name} during '${req.method}': ${err.message}` `` — the method and error class are the two things a crash report is useless without, and both are free at the catch site. For a thrown non-`Error`, `String(err)`.

**`stack`** — the frame lines of `err.stack` with the leading `Name: message` line removed (it duplicates `message`), the workspace prefix stripped, capped at 10 frames. Roughly 1.2 KB at the cap. Absent whenever the caught value is an `EngineError`, is not an `Error`, or carries no `stack`. The distinction between absent and empty is meaningful: absent means "weaver did not misbehave".

**Adversarial cases.** A thrown object with a throwing `toString` — `String(err)` is the only interpolation, and it is the same exposure the current handler already has. A deep async chain — Node's default `Error.stackTraceLimit` is 10, so the cap is belt-and-braces rather than the primary bound. A circular operation result — covered by AC 6.

## Open decisions

Both forks were resolved with the user before this spec was written.

**Decision: do operations keep throwing, or does the error path become a return value further down?**
**Chosen:** operations keep throwing `EngineError`; the dispatcher catches at its own boundary.
**Reasoning:** there are 40 throw sites across domain, engine and operation code, and `EngineError` is the established idiom at all three layers. Converting them means rewriting every operation signature for no observable gain. The dispatcher is the transport boundary — the natural place where an exception becomes a response.
**Consequences:** enables a second transport to be a pure serialiser. Rules out compile-time exhaustiveness over error codes — a new `ErrorCode` still cannot be proven to be handled. Watch for operations that catch and swallow their own `EngineError`s, which would bypass the boundary silently.

**Decision: where does crash detail reach the maintainer — verbose log, or the response?**
**Chosen:** the response, on `INTERNAL_ERROR` only, unconditionally.
**Reasoning:** you cannot opt into diagnostics for an event you did not know was coming. `--verbose` is a daemon flag, off by default, that must be set before the crash — so a stranger reporting a bug reliably does not have it. Not every error, because four codes (`UNKNOWN_METHOD`, `VALIDATION_ERROR`, `INVALID_PATH`, `WORKSPACE_VIOLATION`) are returned by the dispatcher's own guards with no exception behind them, and because routine `EngineError`s like `FILE_NOT_FOUND` would put ten frames of weaver internals into an agent's context on an outcome the agent hits whenever it guesses a path wrong.
**Consequences:** `stack` is in the documented wire contract permanently. The verbose log keeps its stacks — `daemon.ts` reads `res.stack` off the error response instead of off a caught error, so `stripWorkspacePrefix` keeps a live caller. The `EngineError`-vs-not split costs no extra branch: the dispatcher already makes it to choose the code.

## Security

- **Workspace boundary:** no change. This adds no file reads or writes; the dispatcher's existing `validateFilePath` and `WorkspaceScope.contains` guards run exactly as before, in the same order, before any operation is invoked.
- **Sensitive file exposure:** N/A — no file content is read by any code this change touches. Node stack traces carry no local variables, environment, or file content.
- **Input injection:** N/A — no new string parameters. `req.method` is interpolated into the `INTERNAL_ERROR` message, but it is already validated against the `OPERATIONS` table before any operation runs, and an unknown method returns `UNKNOWN_METHOD` without reaching the catch.
- **Response leakage:** `stack` is new content in the response and is the one surface to assess. Weaver never executes workspace code — ts-morph parses it — so frames point at weaver's own `dist/` modules, not the user's project. The workspace prefix is stripped. What remains is weaver's install path, which can reveal the local username; that is the same class already exposed by the absolute paths in `message` and `filesModified`, not a new one. Weaver's module layout is not sensitive: it ships on npm. Present only on `INTERNAL_ERROR`, capped at 10 frames.

## Edges

- `docs/reference/error-codes.md:42` tells the reader to "check daemon logs (`--verbose`)" for `INTERNAL_ERROR`. That guidance is now wrong-by-default and must point at the `stack` field.
- `PARSE_ERROR` stays transport-owned. It describes a malformed wire message, not a failed operation, and `dispatchRequest` never sees the bytes. The daemon's try narrows to `JSON.parse` alone, where every branch is reachable.
- The existing `PARSE_ERROR` integration tests (`daemon.integration.test.ts:169-198`) must keep passing unchanged.
- Guarding serialisation reduces but does not eliminate the mutex-chain hazard: if `handleSocketRequest` ever rejects, `queue = queue.then(…)` is permanently rejected and every later request is dropped. After this change the remaining throw sources are `logger.log` and `socket.write`. Not addressed here — logged as a follow-up.
- `callDaemon` keeps returning `Record<string, unknown>`. Typing it as `DispatchResponse` would force narrowing at `ensure-daemon.ts`, which reads `ping.buildId` off it and gains nothing. Over the wire the type is a claim, not a guarantee.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`. The `dispatcher.test.ts` split is a prep step, not a cleanup step — do it before adding tests.
- [ ] The verbose log still carries a stack for `INTERNAL_ERROR`, read from the error response rather than a caught error
- [ ] Docs updated:
      - `docs/reference/response-format.md` — a `stack` row in the failure table, noting it is present only on `INTERNAL_ERROR`
      - `docs/reference/error-codes.md` — `INTERNAL_ERROR` guidance points at `stack`, not `--verbose`
      - `docs/internals/daemon.md` — the socket handler no longer maps `EngineError`
      - handoff.md current-state section — `dispatcher.ts` and `daemon.ts` line entries
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
