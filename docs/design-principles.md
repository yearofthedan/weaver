**Purpose:** The design-time decisions that shape weaver — what the right *shape* of a change is, before any code is written.
**Audience:** Anyone deciding the shape of a change — during `/spec`, `/brainstorm`, or review.

---

# Design Principles

These answer one question: *"is this the right shape?"* — and they are consulted at **design time**. They are distinct from [code standards](code-standards.md), which answer *"is this written well?"* at implementation time. The distinction matters because of cost: a bad shape caught in review is expensive to unpick; caught in the spec, it never gets built. When `/spec` or `/brainstorm` decides where logic lives, what the boundaries are, and what gets exposed, it decides against this file.

## The Dependency Rule

Source-level dependencies point **inward**: volatile detail (transport, I/O, frameworks, file formats) depends on stable policy (domain logic) — never the reverse. Put each piece of logic in the innermost layer that can hold it.

- **Adapters are thin.** A transport handler — a CLI action, a socket handler, a future HTTP route or queue consumer — translates input, calls one named function, and formats the result. It holds no policy. Logic placed in an adapter is reachable only through that transport and welded to it; the moment you want it from a second entry point, or in a test, you can't get at it.
- **I/O goes through ports.** File reads, writes, and existence checks go through the injectable `FileSystem` port, not `node:fs` in domain or operation code. The port is the seam that lets the core run against `InMemoryFileSystem` in a unit test instead of a temp directory.
- **Testability is the signal, not a separate goal.** "I can't exercise this without spawning the CLI / touching the disk" is the Dependency Rule failing out loud: the logic is sitting in the wrong layer. There is no separate "make it testable" rule — if a unit needs its transport stood up to be tested, move the logic inward until it doesn't. The test-side symptoms of getting this wrong — heavy setup, coverage that only runs through a spawned process — are catalogued as the [test quality model](code-standards.md) in the code standards.

## Information hiding

A module exposes only its contract: the entry point the next layer out needs, and nothing else. Helpers, intermediate types, and internal state stay private. If you are exporting something *only* so a test can call it directly, that is the smell — test through the real entry point, at the real altitude. A wide public surface is a wide blast radius: every export is something another module can come to depend on, and something you can no longer change freely.

## Compute before mutate

A write operation separates computation (read, resolve, validate) from mutation (write, rename, delete). If the compute phase fails, nothing on disk has changed. This is what makes a failure recoverable: import rewrites touch arbitrary files across the workspace, and a half-applied change — some files updated, others not — cannot be rolled back.

## Prefer batch over sequential

When an operation touches multiple interdependent files, compute all changes against one consistent view of the project before writing — rather than looping single-file calls that each observe intermediate state and may rewrite each other's work.

---

How these apply concretely to weaver's engine, operation, and plugin layers — and the structural facts specific to this system — are in [architecture.md](architecture.md). How code that already follows them is written — naming, comments, casts, test structure — is in [code-standards.md](code-standards.md).
