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
- **Prefer rejecting a dependency over injecting one.** A port is the right seam for behaviour the core genuinely calls (a filesystem, a clock). For a *value* the core merely needs — a config flag, a resolved setting, a selected variant — do not inject a reader; take the value as a parameter and let the caller do the reading. A unit that reads its own configuration both decides and does, and the tell is on the test side: the decision is unreachable except by stubbing the environment, and the only thing left to assert is an artefact the unit assembled from its own constants, so the test compares the source against a copy of itself and pins nothing. Injecting an abstraction does not fix that — only moving the decision out does. The composer's contract then becomes real (it can drop the input, ignore it, or assemble it in the wrong order), and the selection reduces to a branch tested through the caller that actually uses it. Tests that instead assert on static content are covered by *Defect reachability* in [`code-standards.md`](code-standards.md).

## Information hiding

A module exposes only its contract: the entry point the next layer out needs, and nothing else. Helpers, intermediate types, and internal state stay private. If you are exporting something *only* so a test can call it directly, that is the smell — test through the real entry point, at the real altitude. A wide public surface is a wide blast radius: every export is something another module can come to depend on, and something you can no longer change freely.

## Minimal shape

Build the smallest shape that delivers the intent. Structure — a new type, module, builder, or classification — needs a force that exists *now*: instances already in front of you, or consistency with a pattern the codebase already uses. A guessed future is not a force: a matrix you plan to add or a symmetry you expect means build flat now and extract when the instances arrive. Reversibility is the reason — duplication is cheap to consolidate once you can see what repeats, while an abstraction shaped around imagined instances is welded to a guess and expensive to unpick.

Validate the foundation before structuring it. Build the crudest thing that produces the signal, confirm it is real, then add structure. Tiers, gating, or classification over a measurement you have not shown can separate its cases organizes a distinction that may not exist.

## Compute before mutate

A write operation separates computation (read, resolve, validate) from mutation (write, rename, delete). If the compute phase fails, nothing on disk has changed. This is what makes a failure recoverable: import rewrites touch arbitrary files across the workspace, and a half-applied change — some files updated, others not — cannot be rolled back.

## Prefer batch over sequential

When an operation touches multiple interdependent files, compute all changes against one consistent view of the project before writing — rather than looping single-file calls that each observe intermediate state and may rewrite each other's work.

## Domain services are format-agnostic

A domain service operates on script content only — it never switches on file extensions or registers format-specific handlers. The plugin architecture exists so framework plugins (Vue, Svelte, …) own their file-format concerns: a plugin extracts the script block from an SFC, calls the domain service, and splices the result back. `ImportRewriter` sees script text, not `.vue` files. If a framework name (`vue`, `svelte`) appears outside the plugin directory or a single registration point, the abstraction is wrong — this is the [Dependency Rule](#the-dependency-rule) and [information hiding](#information-hiding) applied to file formats.

## Specs describe *what*, not *how*

A spec states the change to deliver and where — "move symbol X to file Y", "rename Z across the workspace" — not the manual steps to get there. Prescribing steps competes with the refactoring skills and pushes the executor to hand-edit instead of reaching for `moveSymbol`/`moveFile`/`rename`. The executor owns *how*.

Each acceptance criterion must also leave the codebase in a working state: build and tests pass after it lands. If the natural operation does X+Y atomically, that is one AC, not two.

## Durable artifacts are self-contained

An artifact that gets archived and outlives its surroundings — a spec, a template — must not point *out* to things that rot: a rule name, a skill command, another doc's numbering. State what each section means inline, in the artifact's own words. Routing ("which skill fills this") belongs in the routing docs (CLAUDE rules, handoff, the skill files), never in the artifact.

---

How these apply concretely to weaver's engine, operation, and plugin layers — and the structural facts specific to this system — are in [architecture.md](architecture.md). How code that already follows them is written — naming, comments, casts, test structure — is in [code-standards.md](code-standards.md).
