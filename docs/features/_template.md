# Feature: [Name]

**Purpose:** One line — what capability this gives the agent.

---

## How it works

> **Prompt:** Someone needs to debug this feature failing silently, or extend
> it to handle a new file type. Would this section tell them where to look?

Show the flow from tool call to result. For single-phase operations, a
short paragraph may suffice. For multi-phase operations (moveSymbol,
extractFunction), use a diagram or numbered call chain showing each step,
which module owns it, and where control passes between them.

```
tool call arrives
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   → resolves compiler, validates workspace
  ▼ operation (src/operations/xxx.ts)
  │   → describe each phase
  ▼ compiler (src/compilers/ts.ts or plugins/vue/compiler.ts)
      → what compiler API is called and why
```

Name the actual functions and files. Link to source when a path would
help more than prose.

## Security

> **Prompt:** This feature runs inside an MCP server. An agent — potentially
> manipulated by prompt injection from source-file content — controls the
> inputs. What can go wrong?

For this feature specifically:

- **Input surface** — which parameters come from the agent? How are they
  validated before reaching the engine? (path validation, identifier regex,
  Zod schema, etc.)
- **Output surface** — can the engine produce writes or responses that
  leak content outside the workspace? Which boundary checks apply?
- **Residual risk** — anything this feature can't fully guard against.
  (Example: rename doesn't detect naming collisions; searchText can't
  prevent the agent from acting on prompt-injected content in results.)

Reference `docs/security.md` for the full threat model — don't repeat
the controls catalogue here, just say which ones apply and what's
specific to this feature.

## Constraints

What this feature can't do, what breaks it, and what the caller needs
to know to avoid misuse.

> **Prompt:** If an agent calls this feature with reasonable-looking but
> slightly wrong input (off-by-one position, path to a test file outside
> tsconfig, symbol that exists but isn't exported), what happens? Is the
> failure mode obvious or silent?

## Technical decisions

> **Prompt:** Why is this built this way and not some other way? What
> alternatives were considered and rejected?

Each entry should name the alternative and explain why it was ruled out.
Future maintainers will want to know what *not* to try.
