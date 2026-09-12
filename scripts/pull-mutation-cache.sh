#!/usr/bin/env bash
# Fetches the Stryker incremental caches published by the Quality Feedback
# workflow, so a local run starts from CI's baseline instead of from nothing.
#
# The caches are not in git: CI's copy is the shared one, and a tracked file
# would drift against it (see docs/tech/mutation-testing.md). Requires `gh`
# authenticated against the repo's remote.
#
# A miss is not fatal — a full rebuild is slower, not wrong — so this reports
# what it got and exits 0 either way. It always prints the age of what it
# fetched, because a silently stale baseline looks identical to a fresh one.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

if ! command -v gh >/dev/null 2>&1; then
  echo "gh not found — skipping cache pull; the next mutation run rebuilds from scratch."
  exit 0
fi

mkdir -p reports

fetch_artifact() {
  local artifact=$1 target=$2 id sha created

  while read -r id sha created; do
    [ -z "$id" ] && continue
    if gh run download "$id" --name "$artifact" --dir reports >/dev/null 2>&1; then
      local age="unknown age"
      if [ -n "$created" ]; then
        local secs=$(( $(date +%s) - $(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$created" +%s 2>/dev/null \
                       || date -d "$created" +%s 2>/dev/null || echo 0) ))
        (( secs > 0 )) && age="$(( secs / 3600 ))h old"
      fi
      echo "  $target <- run $id (${sha:0:7}, $age)"
      return 0
    fi
  done < <(gh run list --workflow quality-feedback.yml --branch main --limit 10 \
             --json databaseId,headSha,createdAt \
             --jq '.[] | "\(.databaseId) \(.headSha) \(.createdAt)"' 2>/dev/null)

  echo "  $target <- not found in the last 10 runs; it will rebuild locally."
  return 1
}

echo "Pulling Stryker incremental caches from the Quality Feedback workflow:"
fetch_artifact stryker-incremental reports/stryker-incremental.json
fetch_artifact stryker-eval-incremental reports/stryker-eval-incremental.json
exit 0
