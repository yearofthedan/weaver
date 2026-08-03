# Spike: does the decision-path router do measurable work?

**Status:** Findings recorded — narrows the open question in [skill-design.md](../../skill-design.md)
**Date:** 2026-08-01
**Related:** [eval-design.md](../../eval-design.md), [eval-baselines.md](../../eval-baselines.md),
[skill-design.md](../../skill-design.md)

## Question

Every shipped skill opens with a decision-path router — a bold anti-momentum line plus an
intent → command → **Never** table. It landed in the same commit as two other changes
(gaming-removal, callout blocks) and the gate scores rose, so no element was attributable.
`skill-design.md` recorded it as an unproven working hypothesis. Does the table itself do
anything?

Both outcomes were actionable, which is why it was worth paying for: a real effect means new
skills should copy the pattern; no effect means three shipped files carry a table on the strength
of nothing, and can be simplified.

## Method

Two arms differing **only in structure**. Every fact, command, and displaced shell tool was held
identical; the tables were rewritten as prose paragraphs and the anti-momentum clause kept as a
sentence. Deliberately untouched, to avoid testing two things at once: the `**STOP.**` callout in
`weaver-refactor` (a different device from the same commit), the `**Instead of:**` contrast blocks,
and every frontmatter `description` (which feeds the front-loaded prompt as well as discovery).

`anthropic/claude-haiku-4.5` via OpenRouter, standard pressured gate conditions, temperature
omitted. Arms switched with `git stash`; skill files read off disk at run time, so no run may
overlap an edit.

Case selection was the documented shell-fallback subset — the six front-loaded cases where the
record shows the gate model reaching for `mv`, `sed`, `tsc`, or `grep`. Front-loaded matters: the
body sits in the prompt, so the table is directly under test rather than the description.

## Results

Six-case sweep, n=5 (escalating to 6 below the floor):

| Case | Tables | Prose |
|---|---|---|
| `command-move-file` | 5/5 | 5/5 |
| `command-find-importers` | 5/5 | 5/5 |
| `command-search-text` | 5/5 | 5/5 |
| `command-move-directory` | 4/6 | 3/6 |
| `command-get-type-errors` | 4/6 | **1/6** |
| `command-replace-text` | 4/5 | 5/5 |

Two worse, one better, three unchanged — short of the pre-set bar (several down, none up). The one
large mover was widened:

| Run | Tables | Prose |
|---|---|---|
| 1 | 4/6 | 1/6 |
| 2 | 4/6 | 4/5 |
| 3 | 8/10 | 5/10 |
| **Pooled** | **16/22 (73%)** | **10/21 (48%)** |

## What is supported

**On `command-get-type-errors`, the table helps.** 73% against 48% over 43 trials. A gap that size
arises by chance roughly one run in ten — suggestive, not conclusive, and the direction never
reversed on pooled data.

## What is not

**Generalisation.** The six-case sweep is too mixed to claim it. Most cases sit at 5/5 with the
table in, so they can only demonstrate damage, and mostly showed none.

**Audience relevance — the sharpest limit, and it only became visible afterwards.** The
cross-model sweep run later the same day puts **Gemini 2.5 Flash at 3/3 and GPT-5.6-Luna at 3/3**
on `command-get-type-errors`, both at ceiling. The measured effect is therefore on the single case
that only the gate model struggles with. The table is carrying the weakest model on its weakest
case; the other two never needed it. Read that before citing 73%-vs-48% as evidence the router
works.

## Findings worth keeping

**This case cannot resolve anything at small n.** Under identical conditions the prose arm gave
1/6 and then 4/5. Any n≤6 run on `command-get-type-errors` is uninformative in either direction —
consistent with its observational marker, and a caution for anyone using it as a signal.

**One failure mechanism dominates, and the table does not change its shape — only its
frequency.** In both arms the model runs the shell command, then writes the correct `weaver`
invocation *into a prose message* instead of emitting it as a tool call. Two arm-B trials say so
outright: *"per the guidance provided, I should use `weaver get-type-errors`… Unfortunately, I
don't have access to the weaver tools in my current environment."* The model is not failing to
know; it is failing to convert. That quote also seeded the `npx` lead now queued in handoff — the
skills document a bare `weaver`, which is not how a devDependency is invoked.

**Cost.** A Luna call measured $0.00111 at ~8,600 input / 66 output tokens. Input dominates
entirely: every trial resends all three skill bodies plus the clutter prompt. Prompt caching is the
single largest untouched lever on eval cost.

**As written, the tables are not the terser form.** Measured across the three openers as they
currently stand: 1,919 characters as tables against 1,769 for the prose rewrite — markdown
scaffolding (pipes, separator row, repeated columns) outweighed prose packing the same facts. This
compares two specific texts, not tables against prose in general; a tighter table or a wordier
paragraph would move it. Either way the gap is ~40 tokens against a ~8,600-token prompt, so it
argues in neither direction — but "the table is terser" is not supported by the versions run here,
and should not be offered as a reason to prefer it without measuring the actual texts.

## Recommendation

Keep the tables — on maintenance grounds as much as measured ones. Nothing tested suggests harm,
every pooled comparison leaned their way, the token difference is a rounding error, and the table
states the intent → command → never mapping explicitly where prose has to be parsed for it. But
`skill-design.md` must not promote this to a proven pattern: it is one case, on one model, that two
other models clear at ceiling.

## Method failures — read before running the next one

**Six runs were silently mislabelled.** `pass-cli run --env-file .env` gave the env-file precedence
over the shell environment, so `WEAVER_EVAL_MODEL=<x> pass-cli run …` ran the `.env` model. Runs
labelled Gemini and Luna during the session were Haiku. The comparison itself survived — both arms
ran under the same model, so the comparison stayed fair — but every cross-model reading taken that
day was void, and a baseline record from five days earlier was corrupted the same way. Fixed
same-day; the eval now prints a run header naming the model.

**A conclusion was drawn from a single 4/6-vs-1/6 comparison and did not survive five more
trials.** The mechanism story built on it ("the table drives conversion") collapsed when the prose
arm returned 4/5. One below-floor draw is not a finding, however good the trail reads.

**Splitting pooled data into per-run verdicts is not a legitimate reading.** Presenting "run 2 says
the opposite" against a pooled result picks the favourable slice after the fact. The pooled figure
is the estimate; run-to-run spread is already reflected in how uncertain it is, and showing it
separately double-counts it.

## Addendum (2026-08-03) — does removing the table clean up Luna's boundary over-triggering?

GPT-5.6-Luna is the only model of the three tested that fails the two boundary cases
(`boundary-bash-search-non-ts-project`, `boundary-bash-remove-console-log`), both 0/3, both by
calling `weaver search-text` on a task with no refactor/search intent. Hypothesis: the router
table's `Never` column (`grep` / `grep -C`) is what's driving it to fire weaver on work that
belongs in the shell — table arm vs. arm B (this spike's existing no-table prose stash), same
tables-only prose rewrite, no other change.

Pooled n=13 per arm (3 + widened 10), `openai/gpt-5.6-luna`:

| Case | Tables | Prose |
|---|---|---|
| `boundary-bash-search-non-ts-project` | 0/13 | 0/13 |
| `boundary-bash-remove-console-log` | 1/13 | 3/13 |

`search-non-ts-project` is byte-identical across every trial in both arms — same tool name, same
args, same workspace/glob — so the table has no measurable role in this case at all. `remove-
console-log` moved in the hypothesised direction but not distinguishably from noise: Fisher's exact
on 1/13 vs 3/13 gives p = 0.59.

**Not supported.** Dropping the table does not clean up Luna's boundary cases. The over-triggering
persists almost identically without it, so it isn't the `Never` column doing this — more likely the
shared frontmatter `description` (present in both arms), which pattern-matches "find every
occurrence of X" against tasks that are actually out of scope (a non-TS project, a single-line
edit).

## Addendum 2 (2026-08-03) — does removing the table damage a case Gemini/Luna currently clear?

`command-get-type-errors` is the one case the table measurably helped Haiku on (16/22 vs 10/21,
the main spike above), and both Gemini 2.5 Flash and GPT-5.6-Luna clear it 3/3 *with* the table in
place. Untested until now: whether removing it knocks either model off ceiling — the only way to
tell whether the table protects something invisible to an instrument that's already at ceiling.

Prose arm (`stash@{0}`) applied, table removed from all three skill bodies, same case, n=3 each:

| Model | Table (baseline) | Prose (table removed) |
|---|---|---|
| Gemini 2.5 Flash | 3/3 | 3/3 |
| GPT-5.6-Luna | 3/3 | 3/3 |

**Not supported.** Both hold ceiling with the table removed. Combined with Addendum 1 (removing
the table doesn't fix Luna's failing boundary cases either), the table now has zero measured effect
on either non-gate model, in either direction, on every case tested. The original spike's read
stands: the table carries Haiku on its one weakest case and nothing measured suggests it does
anything for the other two.
