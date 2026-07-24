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

- [x] Cut set applied to `context.test.ts`; criteria added to `docs/code-standards.md`.
- [x] `pnpm test:mutate:eval:file eval/harness/context.ts` survivor set unchanged (still the four regex-anchor mutants, no new survivor).
- [x] `pnpm check` passes.
- [x] No touched file exceeds the code-standards hard flag.
- [x] Stale `docs/eval-readiness.md` status note (2026-07-07 `<available_skills>` blocker, contradicted by the 2026-07-23 baselines) retired — separate `[chore]` commit.
- [x] handoff.md entry removed.
- [x] Spec moved to `docs/specs/archive/` with Outcome section appended.

## Outcome

**Verification:** Ran `pnpm test:mutate:eval:file eval/harness/context.ts` before and after the cuts. `context.ts` scored **59 killed / 4 survived** both times — the four survivors are the identical pre-existing regex-anchor mutants on lines 35–36 (`^name:`/`^description:` `$`-anchor removal and `\s+`→`\s`), confirmed by inspecting the mutation log. No new survivor was exposed, so the 12 removed tests carried zero unique mutation coverage. Full `pnpm check` green (1100 main + 410 eval tests). `context.test.ts` went from ~40 tests to 28.

**What shipped:**
- `context.test.ts`: removed the named non-bug (`skillContext` "does NOT include content for unrequested skills"), the `skillFrontmatters` "no body text in descriptions" non-bug, the `skillLocation` "distinct paths" non-bug, and the two `buildAvailableSkillsPrompt` prose-wording tests (replaced by one structural "appends usage guidance" assertion). Collapsed the `skillContext` block 6→2, using `readSkillFile(...)` as the structural sentinel instead of hardcoded skill copy.
- `docs/code-standards.md`: added a **Defect reachability** dimension to the Tests › Quality model list — the durable "what earns a test" criterion (cut tests of impossible states, content/wording coupling, and constant-echoing).
- `docs/eval-readiness.md`: retired the stale 2026-07-07 framing-blocker note (`[chore]`); logged the lane-table "7B canary" reconciliation as a new `[needs design]` handoff entry.

**Architecture gate:** An Opus read-only review (7 criteria, ordered by external-validity risk) preceded the trim and returned *sound with caveats — proceed*. The harness reads the shipped SKILL.md prose live and moves its metric when the prose changes, so the trim is genuine hygiene, not deck-chairs. The review's real findings (unvalidated canary→audience chain; inert-mock trajectory-coupling; execution-free construct) are documented/bounded and already tracked; none is touched or worsened by this change.

**Test count:** −12 tests (net). No new tests added (this is a subtractive change); the one reworked `buildAvailableSkillsPrompt` test replaced two.

**Mutation score:** `context.ts` 93.65% (59/63 non-ignored killed), unchanged by the trim.

**Reflection:**
- *Went well:* The spike-first approach paid off — reading the whole surface plus the mutation cross-reference located the bloat precisely (concentrated in one file) and stopped the sweep from manufacturing cuts in the lean files to hit a quota. The architecture review was the right gate: it converted "trim tests" from a possible waste into a confirmed-worthwhile change, and surfaced the one thing that actually outranks it (build the real-host validation gate).
- *Watch-out for the next agent:* the eval incremental report (`stryker-eval-incremental.json`) records only the *first* killer per mutant, so "test kills no mutant" over-flags redundancy badly (321/417 here) — it is a candidate signal, never proof. The only sound verification is per-file `test:mutate:eval:file` before/after with an unchanged survivor set. Do not cut on the incremental report alone.
- *Recommendation:* the same lens applies to `agentic-loop.test.ts` (706 lines) and `call-model.test.ts` (490) — the Opus review flagged them as candidates to *look at*, not confirmed bloat. Both read as largely load-bearing; any cut there needs the same mutation-verified before/after, one candidate at a time.
