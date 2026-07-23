#!/usr/bin/env bash
# Runs the light gate when the change is confined to eval/ and docs/, since
# an untouched src tree stays green. Everything else — src, skills, a root
# config or lockfile — falls through to the full gate. The check fails closed,
# so any path it doesn't recognise takes the full run.
set -eu

staged=$(git diff --cached --name-only --diff-filter=ACMR)
outsiders=$(printf '%s\n' "$staged" | grep -vE '^(eval|docs)/' || true)

if [ -n "$staged" ] && [ -z "$outsiders" ]; then
  pnpm exec biome check .
  pnpm test:eval
else
  pnpm exec biome check .
  pnpm build
  pnpm test:all
fi
