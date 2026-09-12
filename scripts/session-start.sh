#!/usr/bin/env bash
# Brings a working copy to a clean starting point: main, up to date, with CI's
# mutation baselines in place.
#
# Refuses to run against a dirty tree rather than stashing or discarding —
# deciding what happens to uncommitted work is the developer's call, not this
# script's.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Working tree has uncommitted changes — commit or stash them first:"
  git status --short --untracked-files=no
  exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "Switching from $branch to main."
  git checkout main || exit 1
fi

git pull --ff-only || exit 1
echo "main is at $(git rev-parse --short HEAD) ($(git log -1 --format=%s))"

./scripts/pull-mutation-cache.sh
