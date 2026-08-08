# Running the eval

How to run the hosted skill-file eval. For what it measures and why, see [`docs/eval-design.md`](../docs/eval-design.md).

## Setup

Copy the committed config template to a gitignored `.env`:

```bash
cp .env.example .env
```

The three required vars (`global-setup.llm.ts` fails fast if any is missing) are `WEAVER_EVAL_BASE_URL`, `WEAVER_EVAL_MODEL`, and `WEAVER_EVAL_API_KEY`. `.env.example` carries the endpoint default.

**`WEAVER_EVAL_MODEL` must be set on the command line, not in `.env`.** Env-file resolvers (`pass-cli` included) overlay the file onto your inherited shell environment and win on conflicts, so a model stored in `.env` would silently override any swap you pass inline — which is how a run can answer with the wrong model and print nothing to say so.

**Supply the API key by reference, never as a raw value on disk.** Set `WEAVER_EVAL_API_KEY` to a secret reference that your password-manager CLI resolves at run time (with `pass-cli`, a `pass://…` pointer to your OpenRouter key entry — see `.env.example`). Do not print the key or write its resolved value to a file. Run under the resolver so the value lives only in memory:

```bash
WEAVER_EVAL_MODEL=anthropic/claude-haiku-4.5 pass-cli run --env-file .env -- pnpm eval --disable-console-intercept
```

## Commands

```bash
pnpm eval                              # the whole gate
pnpm eval -t <case-regex>              # filter to a case subset
WEAVER_EVAL_TRIALS=10 pnpm eval -t <case-regex>   # widen an ambiguous case

pnpm eval:gate                         # every roster model in sequence — what a skill edit must clear
pnpm eval:gate -t <case-regex>         # the same, scoped to a case subset
```

`pnpm eval:gate` is the command a skill-file change has to pass. It runs the lane once per roster model at that model's base trial count (Haiku 3, Gemini 10, Luna 10), keeps going after a model fails so you get all three results, prints a per-model pass/fail and cost summary, and exits non-zero if any model failed. Roughly $1.30 for a full run. The roster is `GATING_MODELS` in `eval/harness/config.ts`.

Always pass `--disable-console-intercept` — without it vitest swallows the per-case rate and trail output on *passing* tests, so a green run prints nothing and a paid run is wasted. `pnpm eval:gate` passes it for you.

## Knobs

| Variable | Effect |
|---|---|
| `WEAVER_EVAL_TRIALS` | Base trials per case (default 3; `eval:gate` supplies the roster's per-model count instead). Anything short of a clean sweep escalates to 6 on its own. Set here it wins over the roster, for a spot-check. |
| `WEAVER_EVAL_MODEL` | Swap the model for a single-model run — e.g. `google/gemini-2.5-flash`. Set per model by `eval:gate`. |
| `WEAVER_EVAL_TEMPERATURE` | **Diagnostic.** Unset (the default) omits the field entirely, so the model samples at its own default. Set `0` to replay one deterministic path. |
| `WEAVER_EVAL_CLEAN=1` | **Diagnostic.** Drops clutter and momentum, separating "the body broke" from "it loses under pressure". |
| `WEAVER_EVAL_DEBUG=1` | Dump the full turn-by-turn exchange. |

Neither diagnostic changes gating semantics. Runs cost real money — scope the case set and trial count to the question, and see [Reading a red](../docs/eval-design.md#reading-a-red) for the order to work through a failure.
