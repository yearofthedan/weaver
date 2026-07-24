# Trim eval-harness test bloat + record the criteria

**type:** change
**date:** 2026-07-24
**tracks:** handoff.md "Critically assess the eval harness + its tests for bloat" → docs/code-standards.md

---

## Context

The eval harness grew fast and its unit tests trend over-engineered. An Opus architecture review cleared the harness itself — it reads the shipped SKILL.md prose live and demonstrably moves its metric when the prose changes, so trimming test bloat is not deck-chairs. The review's guidance: sweep `eval/harness/*.test.ts`, keep the matcher tests (`assertions.test.ts`) where a killed mutant is worth its lines. The bloat is concentrated in `context.test.ts`, which tests thin wrappers (`readSkillFile`, `skillLocation`, `skillContext`) around a regex parser and template literals.

## User intent

*As a developer maintaining weaver's skill files, I want the eval harness's own tests to fail only when real behaviour breaks — not when I reword a skill or a prompt string — so that the eval's green/red is a trustworthy signal about skill quality rather than noise I have to re-baseline.*

The eval exists to measure whether shipping the SKILL.md files makes an agent use weaver correctly. Tests that assert against impossible states or couple to shipped prose add maintenance drag without guarding any defect, eroding trust in the suite that guards the guard.

## Relevant files

- `eval/harness/context.ts` — the subject: `skillContext` is `names.map(readSkillFile).join(sep)` (no filter path); `parseSkillFrontmatter` regex parser; `classifySkillReach` (real logic); template builders.
- `eval/harness/context.test.ts` — the heavy file (~40 tests, 251 lines); the cut list below targets it.
- `docs/code-standards.md` — the "Tests › Quality model" list is the home for the durable criteria; line 60 already covers templated-sibling redundancy.
- `reports/stryker-eval-incremental.json` — cross-reference; `pnpm test:mutate:eval:file eval/harness/context.ts` is the verification instrument.

### Red flags

`context.test.ts` couples to shipped-skill *content* (`"weaver rename"`, `"weaver find-references"`) and to exact prompt *wording* (`"invoke it as a tool by name"`), and contains at least one test of a non-bug (`skillContext` "does NOT include content for unrequested skills" — the code has no exclusion path). These are the target, not incidental.

**Layer-fit:** all cuts are pure-unit — no fixture/workspace wiring. Verification is per-file mutation, not integration.

## Value / Effort

- **Value:** The eval's own suite stops firing on benign skill-prose or prompt edits, so a red run reliably means real behaviour broke. The criteria, recorded in `code-standards.md`, stop the next agent re-growing the same bloat.
- **Effort:** Low. One test file trimmed, one doc paragraph added, one stale doc note retired. No source change. Every cut mutation-verified.

## Behaviour

This is a test-hygiene change, so the "behaviour" is the criteria + the cut set, not new runtime behaviour.

**Criteria added to `docs/code-standards.md` (Tests › Quality model)** — a test earns its place only if a reachable code path (or a plausible future edit) could produce the failure it guards. Cut a test that:
- asserts the absence of a state the code structurally cannot produce (no code path could make it true — e.g. filtering in a function with no filter);
- couples to shipped external *content* or exact prose *wording* rather than structure/behaviour (breaks on benign edits, kills no logic mutant);
- re-encodes a constant/table as test data and asserts the table equals a copy of itself.

**Cut set (`context.test.ts`):**
- [ ] `skillContext › "does NOT include content for unrequested skills"` — removed (non-bug: `map`+`join`, no exclusion path).
- [ ] `skillFrontmatters › "does NOT include the full SKILL.md body text in descriptions"` — removed (non-bug: `^description:\s+(.+)$/m`, `.+` cannot cross newlines; also content-coupled).
- [ ] `skillLocation › "returns distinct paths for each shipped skill"` — removed (distinctness follows from `SKILL_NAMES` distinctness).
- [ ] `buildAvailableSkillsPrompt` instruction-wording tests ("invoke it as a tool by name"; "loaded into the conversation"/"bash") — collapsed to at most one structural assertion; the prose-substring coupling is dropped.
- [ ] `skillContext` block collapsed 6 → 2: one "each requested skill's body appears" (minimal structural sentinel, not shipped-content strings) + one "throws for a missing skill". The two throw-variant tests collapse to one.

**Keep (load-bearing, do not weaken):** `parseSkillFrontmatter` branch tests (mocked synthetic content — they kill parser mutants), all `classifySkillReach` tests, the structural `buildAvailableSkillsPrompt` assembly assertions (block/name/location present).

## Interface

None. No source or public surface changes. Test-only edits plus doc text.

## Open decisions

(none)

## Security

N/A — test and doc edits only; no filesystem, boundary, input, or response surface touched.

## Edges

- The four `parseSkillFrontmatter` regex-anchor survivors already present in `context.ts` (name/description `^`-anchor and `\s+`→`\s` mutants) are pre-existing coverage gaps, not caused by this trim. This change must not *raise* the survivor set; closing those gaps is out of scope.
- Verification bar: `pnpm test:mutate:eval:file eval/harness/context.ts` survivor set is identical before and after. If any cut raises a survivor, that test was load-bearing — keep or rework it.

## Done-when

- [ ] Cut set applied to `context.test.ts`; criteria added to `docs/code-standards.md`.
- [ ] `pnpm test:mutate:eval:file eval/harness/context.ts` survivor set unchanged (still the four regex-anchor mutants, no new survivor).
- [ ] `pnpm check` passes.
- [ ] No touched file exceeds the code-standards hard flag.
- [ ] Stale `docs/eval-readiness.md` status note (2026-07-07 `<available_skills>` blocker, contradicted by the 2026-07-23 baselines) retired — separate `[chore]` commit.
- [ ] handoff.md entry removed.
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended.
