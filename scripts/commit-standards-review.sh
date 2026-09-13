#!/usr/bin/env bash
# commit-msg gate: reviews the prose a commit introduces — its message, added
# markdown, and added code comments — against docs/communication-standards.md.
# Findings go to stderr and reject the commit; git retains the staged changes.
#
# commit-msg fires with the index staged and before the commit object exists, so
# the reviewed content is the committed content, and any commit is covered
# whatever made it.
#
# Committing the same message over the same staged content matches the recorded
# hash and goes through; changing either reviews afresh.
#
# Written for bash 3.2 (macOS): no heredoc inside $( ), no arrays, no ${x^^}.
set -uo pipefail

# A COMMIT_REVIEW_CMD already set in the environment picks the runner and model.
COMMIT_REVIEW_CMD="${COMMIT_REVIEW_CMD:-omp -p --model deepseek/deepseek-v4.1-flash --no-tools --no-session}"

MSG_FILE="${1:-}"
REPO=$(git rev-parse --show-toplevel 2>/dev/null)
[ -n "$REPO" ] || exit 0
STANDARDS="$REPO/docs/communication-standards.md"
FLAG="$REPO/.git/commit-review-blocked"   # hash of the last rejected attempt

# Clearing the flag restores review for this message on its next commit.
allow() { rm -f "$FLAG"; exit 0; }

[ -n "$MSG_FILE" ] && [ -f "$MSG_FILE" ] || allow
[ -f "$STANDARDS" ] || allow

cd "$REPO" || allow
git diff --cached --quiet && allow   # nothing staged (e.g. a bare --amend)

# Only the subject line. The body is a dated record whose job is to restate
# context a future reader lacks, which the living-doc rules for placement and
# relevance read as a fault.
SUBJECT=$(git stripspace --strip-comments < "$MSG_FILE" | head -1)
[ -n "$SUBJECT" ] || allow

# Prose under review: added markdown lines and added code comments.
PROSE=$(git diff --cached -U0 | awk '
  /^\+\+\+ b\// { path = substr($0, 7); next }
  /^\+/ && !/^\+\+\+/ {
    line = substr($0, 2)
    body = line; sub(/^[ \t]*/, "", body)
    if (path ~ /\.(md|mdx|txt)$/ || body ~ /^(\/\/|\/\*|\*|#|<!--)/) {
      if (path != shown) { print "\n--- " path; shown = path }
      print line
    }
  }
' | head -c 40000)

HASH=$(printf '%s\n%s' "$SUBJECT" "$PROSE" | shasum | cut -d' ' -f1)
[ -f "$FLAG" ] && [ "$(cat "$FLAG")" = "$HASH" ] && allow

command -v "${COMMIT_REVIEW_CMD%% *}" >/dev/null 2>&1 || {
  echo "commit-standards review skipped: ${COMMIT_REVIEW_CMD%% *} is not on PATH" >&2
  allow
}

PROMPT_FILE=$(mktemp -t commit-review)
trap 'rm -f "$PROMPT_FILE"' EXIT

cat > "$PROMPT_FILE" <<PROMPTEOF
You are reviewing writing that is about to be committed, against this project's
communication standards.

<standards>
$(cat "$STANDARDS")
</standards>

Review two things, by different rules.

1. The commit subject line:

<subject>
$SUBJECT
</subject>

A subject follows conventional commits in the imperative: reading it as
"after I apply this commit it will <subject>" should make sense. It is a short
label, so sentence form, grammatical completeness, length, and how much detail
it carries are all correct as they are. Judge it only for hype, dramatic
framing, editorialising lead-ins, and banned phrases.

2. The prose this commit adds — markdown and code comments:

<prose>
$PROSE
</prose>

This prose is durable documentation, so the full standards apply. Be strict
about walk-up paragraphs and dramatic framing, hype, "not just A but B",
affirm-then-justify openers, editorialising lead-ins, describing negative
space, hidden assumptions stated as fact, and content that mattered to the
conversation but not to a future reader.

Judge ONLY against the standards above. Ignore code correctness, naming, and
formatting.

If nothing meaningfully violates the standards, reply with exactly: PASS
Otherwise reply with up to 5 findings, one line each, in the form:
  <file or "subject"> - "<the offending phrase>" - <which rule it breaks>
No preamble. No praise. Do not suggest rewrites.
PROMPTEOF

# Unquoted on purpose: the variable carries a command and its flags, and this
# script targets bash 3.2, where arrays are unavailable.
REVIEW=$($COMMIT_REVIEW_CMD < "$PROMPT_FILE" 2>/dev/null)

[ -n "$REVIEW" ] || allow                                   # reviewer failed: fail open
printf '%s' "$REVIEW" | head -1 | grep -q '^PASS' && allow

printf '%s' "$HASH" > "$FLAG"
printf '\nCommunication-standards review found:\n\n%s\n\nRevise against docs/communication-standards.md and commit again; the revision is reviewed afresh. To override, commit the same message over the same staged content and it will go through unreviewed.\n' "$REVIEW" >&2
exit 1
