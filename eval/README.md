# Running the eval

How to run the hosted skill-file eval. For what it measures and why, see [`docs/eval-design.md`](../docs/eval-design.md).

## Setup

Copy the committed config template to a gitignored `.env`:

```bash
cp .env.example .env
```

The three required vars (`global-setup.llm.ts` fails fast if any is missing) are `WEAVER_EVAL_BASE_URL`, `WEAVER_EVAL_MODEL`, and `WEAVER_EVAL_API_KEY`. `.env.example` carries the endpoint and model defaults.

**Supply the API key by reference, never as a raw value on disk.** Set `WEAVER_EVAL_API_KEY` to a secret reference that your password-manager CLI resolves at run time (with `pass-cli`, a `pass://…` pointer to your OpenRouter key entry — see `.env.example`). Do not print the key or write its resolved value to a file. Run under the resolver so the value lives only in memory:

```bash
pass-cli run --env-file .env -- pnpm eval --disable-console-intercept
```

## Commands

```bash
pnpm eval                        # all lanes
pnpm eval gate                   # the unified sampled rate gate lane only
pnpm eval -t <case-regex>        # filter cases
WEAVER_EVAL_TRIALS=6 pnpm eval gate   # re-check a surprising rate
```

`WEAVER_EVAL_TEMPERATURE` (default 0.7) and `WEAVER_EVAL_TRIALS` (default 3) tune the agentic rate lane. Runs cost real money against the hosted model — scope the case set and trial count to the question ([Working discipline](../docs/eval-design.md#working-discipline)).
