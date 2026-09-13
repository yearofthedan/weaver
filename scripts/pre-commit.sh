#!/usr/bin/env bash
# Runs the light gate when the change is confined to eval/ and docs/, since
# an untouched src tree stays green. Everything else — src, skills, a root
# config or lockfile — falls through to the full gate. The check fails closed,
# so any path it doesn't recognise takes the full run.
set -eu

staged=$(git diff --cached --name-only --diff-filter=ACMR)

# An agent defined for both harnesses is two files, one per harness, because
# each parses frontmatter the other rejects. Staging one side without the other
# usually means the pair has gone out of sync — say so and carry on, since
# whether that is deliberate is the author's call and not this script's.
agents_touched() { printf '%s\n' "$staged" | grep -q "^$1/agents/"; }
if agents_touched .claude && ! agents_touched .omp; then
  echo "note: .claude/agents changed but .omp/agents did not — check the OMP copy" >&2
fi
if agents_touched .omp && ! agents_touched .claude; then
  echo "note: .omp/agents changed but .claude/agents did not — check the Claude Code copy" >&2
fi

outsiders=$(printf '%s\n' "$staged" | grep -vE '^(eval|docs)/' || true)

if [ -n "$staged" ] && [ -z "$outsiders" ]; then
  pnpm exec biome check .
  pnpm test:eval
else
  pnpm exec biome check .
  pnpm build
  pnpm test:all
fi
