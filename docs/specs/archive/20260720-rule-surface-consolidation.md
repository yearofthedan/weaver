# Consolidate and streamline the rule surface

**type:** change
**date:** 2026-07-20
**tracks:** handoff.md # consolidate-and-streamline-the-rule-surface → CLAUDE.md, .claude/MEMORY.md, docs/code-standards.md, docs/design-principles.md

---

## Context

The repo has two overlapping rule corpora — `CLAUDE.md` (Rules 1–21) and `.claude/MEMORY.md` (its own "Hard-won rules" + "Agent behaviour" sections) — with no stated boundary, so neither is authoritative and a new learning has no obvious home. Two facts sharpen the fix. (1) **`MEMORY.md` is not auto-loaded** — nothing `@import`s it, no setting references it, no skill or agent reads it — so every rule in it is dormant, applying only when an agent happens to open the file. (2) The codebase already has the right homes for most of what has accumulated: `docs/code-standards.md` ("is it written well?") and `docs/design-principles.md` ("is it the right shape?") already own sections that duplicate CLAUDE/MEMORY rules. This changeset makes `CLAUDE.md` the single canonical home for *cross-cutting process* rules, routes craft/shape/domain/procedure content to the docs and skills that already own those concerns, deletes `MEMORY.md`, and adds a routing map so any future rule has one deterministic home.

## User intent

*As a developer working in this repo, I want each rule to live in exactly one place that is actually loaded when it's relevant, so that the guidance governing my work is authoritative and I never have to guess "which file does this belong in?"*

## Relevant files

- `CLAUDE.md` — the 21 numbered rules + Commits section; becomes the canonical *process* rules file with a routing map. Auto-loaded, so the only reliably-live rule surface.
- `.claude/MEMORY.md` — to be deleted; its residue is redistributed. Not auto-loaded (the core defect).
- `docs/code-standards.md` — already sectioned for craft rules ("Before extending an existing file", "Tests/Quality model", "Source extraction = test review", "Type casts", "Defensive code vs dead branches"); absorbs the craft rules.
- `docs/design-principles.md` — Dependency Rule / Information hiding / Minimal shape; absorbs the shape rules.
- `docs/handoff.md` — owns current state; the routing-map entry updates and the MEMORY "Key docs" function is reconciled here.
- `docs/eval-design.md` — receives the hosted-eval runbook from MEMORY.md.
- `.claude/agents/execution-agent.md` — loads `CLAUDE.md` + `code-standards.md` on a fixed step; receives the executor-facing mutation-cache action (the gap fix).
- `docs/tech/mutation-testing.md`, `docs/internals/move-symbol.md`, `docs/internals/daemon.md` — receive migrated domain/tool gotchas.
- `.claude/skills/{mutate-triage,using-git-worktrees}/SKILL.md` — receive migrated workflow procedures.

### Red flags

The target state itself is the cleanup — there is no separate code smell. The "smell" is the current rule surface: broken numbering (Rule 10 above Rule 9, no Rule 12, a self-reference to "Rule 9"), a dormant second corpus, and ~6 duplicated principles. **Test hotspots:** N/A — docs-only change, no test files touched. **Layer-fit:** N/A — no runtime behaviour.

## Value / Effort

- **Value:** A developer (and every subagent) gets guidance that is authoritative because it's singular and loaded. Today a craft rule may sit only in the un-loaded `MEMORY.md`, so it silently doesn't apply; a new learning stalls on "which file?". After this, a deterministic routing map answers that in one lookup, and the executor's fixed-step reads of `CLAUDE.md` + `code-standards.md` mean the rules that govern code actually reach the agent writing it.
- **Effort:** Docs + skill/agent-definition edits only — no source, no tests, no interface. Surface: ~8 files. No new infrastructure. The cost is judgment, not plumbing: each merge is a call about whether two rules state one principle. Stays frontier-led per CLAUDE's `[needs design]` orchestration note — not handed to a `/slice` executor.

## Behaviour

Acceptance criteria are end-state assertions about the rule surface. Verification for each is a grep/read of the named file(s).

- [ ] **AC1 — `MEMORY.md` is deleted, its residue redistributed.** After: `.claude/MEMORY.md` does not exist. The hosted-eval runbook moves to `docs/eval-design.md`. The "Current state" pointer and "Key docs" function are served by `docs/handoff.md` + the CLAUDE routing map (AC7). The `~/.claude/`-is-wiped redirect is already a CLAUDE rule and stays there. *Laziest wrong impl:* emptying the file but leaving a stub, or dropping the eval runbook on the floor — verify the runbook content exists in `eval-design.md` and every non-rule item has a named new home.

- [ ] **AC2 — `CLAUDE.md` holds only cross-cutting process rules, themed and unnumbered.** Rules are grouped under stable titled headings (e.g. *Diagnose before acting*, *Task workflow & tags*, *Commit hygiene*, *Knowledge capture*), no "Rule N". Craft, shape, domain, and single-workflow-procedure rules are gone from `CLAUDE.md` (migrated per AC3–AC5), except a one-line routing pointer where a process rule needs one. *Verify:* no `**Rule [0-9]` remains; the surviving rules are all "how the agent works across all work."

- [ ] **AC3 — Craft rules migrated to `docs/code-standards.md`, no residue.** The rules about how *code* is written — assess-before-extending (Rule 13), static imports (Rule 19), experienced-engineer craft (Rule 17), the test-quality half of Rule 5, pin-exact-versions (Rule 11), no-narrative-in-code/docs (Rule 21) — live in `code-standards.md`, each stated once. Where they duplicate an existing section (Rule 13 ↔ "Before extending an existing file"; Rule 5 ↔ "Quality model"), they merge into it rather than append. *Verify:* the principle appears in `code-standards.md` and not in `CLAUDE.md`.

- [ ] **AC4 — Shape rules migrated to `docs/design-principles.md`.** Domain-services-must-not-know-file-formats, specs-describe-*what*-not-*how*, and each-AC-leaves-a-working-state live in `design-principles.md` (the first folds into Dependency Rule / Information hiding). *Verify:* present in `design-principles.md`, absent from `CLAUDE.md`/`MEMORY.md`.

- [ ] **AC5 — Domain gotchas → owning docs; workflow procedures → their internal skill.** `moveSymbol` append/test-file behaviour → `docs/internals/move-symbol.md`; daemon→VolarCompiler routing → `docs/internals/daemon.md`; Stryker `--mutate`/`--force` flags and the classify-survivors triage principle (Rule 20) → `docs/tech/mutation-testing.md` + `mutate-triage` skill; worktrees-for-parallel-ACs → `using-git-worktrees` skill; execution-agent-prompt-no-step-comments → `.claude/agents/execution-agent.md`. *Verify:* each item present in its named home, absent from the rule surface.

- [ ] **AC6 — Every principle is stated exactly once.** No principle appears in two files. The known duplicates (memory-location, tee, verify-empirically, use-weaver-not-grep, commit-hygiene, spec-identifier-refs, source-extraction=test-review) each survive in one canonical home only. *Laziest wrong impl:* copying a rule to its new home without deleting the original — verify by grepping each principle's key phrase returns one file.

- [ ] **AC7 — `CLAUDE.md` carries a "Where the rules live" routing map, and every migrated rule's destination is loaded by the role that acts on it.** The map is the authority-per-decision table (craft→code-standards, shape→design-principles, workflow-procedure→internal skill, domain→internals/tech, process→CLAUDE, state→handoff, never→shipped `weaver-*` skill). For each migrated rule, confirm the destination is read by whoever needs it — craft/process by the executor (loads `CLAUDE.md`+`code-standards.md` on fixed steps), shape by the orchestrator/`/spec`. Where a needed loader doesn't reach the destination, patch the loader or keep a thin CLAUDE pointer. *Verify:* the map exists in `CLAUDE.md`; a walk of each migrated rule confirms its home is on the acting role's load path.

- [ ] **AC8 — Executor mutation-cache gap closed.** Because Rule 16 (commit `reports/stryker-incremental.json` after a mutation run) is an executor *action* and the executor does not load `mutation-testing.md`, the instruction lives in `.claude/agents/execution-agent.md` step 8 (where it already runs `pnpm test:mutate`), not only in the tech doc. *Verify:* `execution-agent.md` step 8 instructs committing the updated incremental cache; the executor never depends on reading `mutation-testing.md` to know this.

- [ ] **AC9 — Living rule-number references fixed; archived-spec references left as history.** The one live cross-reference inside `CLAUDE.md` ("Rule 9") is rewritten to name the rule, not its number. References in `docs/specs/archive/**` are immutable history and stay untouched. *Verify:* no live doc/skill references a rule by number; archived specs unchanged.

> **Type matrix check:** N/A — no code paths, file extensions, or engine variants. The only "types" are rule *categories*, and AC3–AC5 enumerate each category with a distinct destination.
> **Split test:** One indivisible reorganization. A partial slice (e.g. delete MEMORY + theme CLAUDE, defer the craft/shape migration) leaves rules mid-move across three files — a worse state than the start. The high AC count reflects the number of destinations touched in one atomic move, not two shippable verticals.

## Interface

N/A — no public surface. No CLI action, socket handler, schema, or tool contract changes. Documentation and agent/skill configuration only.

## Open decisions

None. The two forks (numbering scheme → themed/unnumbered; merge depth → merge clusters with specifics as sub-bullets) and the three follow-on questions (delete MEMORY.md; three-way authority split; executor load-path) were resolved with the user during design and are fixed by AC2, AC3–AC5, AC7, and AC8.

## Security

- **Workspace boundary:** N/A — no file-path handling code changes.
- **Sensitive file exposure:** The hosted-eval runbook moving to `docs/eval-design.md` must preserve the existing discipline — reference the secret by password-manager location, never a raw key, and keep personal-environment specifics out of the git-tracked doc (this is itself one of the rules being consolidated). Verify no secret value is materialized during the move.
- **Input injection:** N/A.
- **Response leakage:** N/A.

## Edges

- Archived specs under `docs/specs/archive/**` must not be edited — they are historical records; stale "Rule N" references in them are acceptable.
- The `~/.claude/`-is-wiped redirect must survive the MEMORY.md deletion (it already exists as a CLAUDE rule — confirm it is not the *only* copy being deleted).
- No rule content may be lost in the merge — every principle in either source file must be traceable to exactly one destination (AC6). A merge that generalizes a rule must keep its actionable specifics as sub-points, not discard them.
- Shipped `weaver-*` skills must not receive any agent-policy/procedure content (they are external tool-interface docs).

## Done-when

- [ ] All ACs verified by reading/grepping the named files.
- [ ] `.claude/MEMORY.md` deleted; no dangling references to it remain in loaded docs/skills/agents (grep for `MEMORY.md` returns only historical/archive mentions or the deletion itself).
- [ ] `pnpm check` passes (docs-only, but confirms no doc referenced by a build/test step broke).
- [ ] Every principle from both source files is traceable to exactly one destination (no loss, no duplication).
- [ ] The routing map in `CLAUDE.md` is self-consistent with where AC3–AC5 actually placed each rule category.
- [ ] `docs/handoff.md` entry removed; spec moved to `docs/specs/archive/` with an Outcome section.
- [ ] Any learning from doing this (e.g. a category the routing map missed) folded into the owning doc, not a new standalone rule.

## Outcome

Shipped. `.claude/MEMORY.md` deleted; `CLAUDE.md` restructured into themed, unnumbered process rules under a "Where the rules live" routing map. Craft rules → `code-standards.md` (new *Imports*, *Dependencies*, *Engineering judgment* sections); shape rules → `design-principles.md` (*Domain services are format-agnostic*, *Specs describe what not how*, *Durable artifacts are self-contained*); domain gotchas → `internals/move-symbol.md` + `internals/daemon.md`; mutation flags/triage → `tech/mutation-testing.md`; parallel-AC procedure → `using-git-worktrees` skill. Executor mutation-cache gap closed in `execution-agent.md` step 8. Routers updated (`handoff.md`, `docs/README.md`, both spec templates). Verified: no dangling `MEMORY.md` refs, no `Rule N` left in `CLAUDE.md`, each principle stated in one file, `pnpm check` green.

Deviations from the drafted ACs, decided with the user during implementation:

- **AC1 destination changed.** The eval runbook was split into a new **`eval/README.md`** (operational — setup, secret injection, run commands) rather than folded into `eval-design.md`, to separate operational content from design by purpose. Config/secrets stay in `.env.example` (not duplicated). `eval-design.md` became design-only: Date line + its changelog narration dropped, `Purpose`/`Audience` header added, operational block replaced with a pointer.
- **AC3 refinement.** The no-narrative rule (old Rule 21) stayed in `CLAUDE.md` as a *Communication style* process rule — it governs chat, commits, and docs, which is agent communication, not code craft; the code-narration face already lived in `code-standards.md` §Comments. The "personal-environment specifics" clause landed under `CLAUDE.md` §Knowledge capture, not writing style.
- **Weaver-vs-grep rule thinned** to policy only — the per-skill routing table duplicated the skill descriptions (surfaced every session), so it was cut.
- **A migrated claim was corrected, not copied.** The Stryker `--force` guidance was verified against the installed schema: `--force` re-runs *every mutant in scope* (a full rebuild of the incremental file), so it must be paired with `--mutate` and never run against a bare `pnpm test:mutate`. The original MEMORY note implied a cheap targeted re-check.
