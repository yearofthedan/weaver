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
# fetched, because a silently stale baseline looks identical to a fresh one,
# and it prints the underlying error on a miss rather than implying the
# artifact was absent.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

if ! command -v gh >/dev/null 2>&1; then
  echo "gh not found — skipping cache pull; the next mutation run rebuilds from scratch."
  exit 0
fi

mkdir -p reports

fetch_artifact() {
  local artifact=$1 target=$2
  local id sha created last_error="no run in the last 10 carried this artifact"

  while read -r id sha created; do
    [ -z "$id" ] && continue

    # Stage through a temp dir: `gh run download` refuses to overwrite an
    # existing file, which is the normal case here once a cache is in place.
    local tmp
    tmp=$(mktemp -d) || return 1

    if last_error=$(gh run download "$id" --name "$artifact" --dir "$tmp" 2>&1); then
      local downloaded
      downloaded=$(find "$tmp" -type f -name '*.json' | head -1)
      if [ -n "$downloaded" ]; then
        mv -f "$downloaded" "$target"
        rm -rf "$tmp"

        local age="unknown age"
        local epoch
        # -u: the timestamp is UTC. Without it BSD date reads it as local
        # time and the age is wrong by the offset — worse than no age at all.
        epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$created" +%s 2>/dev/null \
                || date -u -d "$created" +%s 2>/dev/null)
        if [ -n "${epoch:-}" ]; then
          local mins=$(( ( $(date +%s) - epoch ) / 60 ))
          if (( mins < 60 )); then age="${mins}m old"; else age="$(( mins / 60 ))h old"; fi
        fi
        echo "  $target <- run $id (${sha:0:7}, $age)"
        return 0
      fi
      last_error="artifact contained no .json file"
    fi
    rm -rf "$tmp"
  done < <(gh run list --workflow quality-feedback.yml --branch main --limit 10 \
             --json databaseId,headSha,createdAt \
             --jq '.[] | "\(.databaseId) \(.headSha) \(.createdAt)"' 2>/dev/null)

  echo "  $target <- not fetched (${last_error%%$'\n'*}); it will rebuild locally."
  return 1
}

echo "Pulling Stryker incremental caches from the Quality Feedback workflow:"
fetch_artifact stryker-incremental reports/stryker-incremental.json
fetch_artifact stryker-eval-incremental reports/stryker-eval-incremental.json
exit 0
