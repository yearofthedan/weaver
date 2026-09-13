#!/usr/bin/env bash
# Pre-commit gate shared by both harnesses: critiques the prose in a staged
# commit — the commit message, added markdown, and added code comments —
# against docs/communication-standards.md. The caller supplies the reviewer
# through COMMIT_REVIEW_CMD and reads a Claude-Code-shaped decision on stdout;
# Claude Code runs this directly as a PreToolUse(Bash) hook, and OMP's
# .omp/hooks/pre/commit-standards.ts adapts the same contract.
#
# Findings block the attempt and record a hash of what was reviewed. Repeating
# that exact attempt — same command, same staged prose — is the override: the
# hash matches and it goes through. Change either, and it is reviewed afresh.
# A successful commit clears the record.
#
# Written for bash 3.2 (macOS): no heredoc inside $( ), no arrays, no ${x^^}.
set -uo pipefail

REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$REPO" ] || exit 0
STANDARDS="$REPO/docs/communication-standards.md"
FLAG="$REPO/.git/commit-review-blocked"   # holds the hash of the last rejected attempt

allow() { exit 0; }

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))')

# Only gate real commits.
printf '%s' "$CMD" | grep -Eq '(^|[;&|] *)git +([^|;&]* )?commit([ ]|$)' || allow
[ -f "$STANDARDS" ] || allow

cd "$REPO" || allow
git diff --cached --quiet && allow   # nothing staged (e.g. a bare --amend)

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

[ -n "$PROSE" ] || allow

# Repeating a rejected attempt verbatim is the override.
HASH=$(printf '%s\n%s' "$CMD" "$PROSE" | shasum | cut -d' ' -f1)
[ -f "$FLAG" ] && [ "$(cat "$FLAG")" = "$HASH" ] && allow

# The reviewer is whichever harness invoked this script, and it must say so.
# There is no default: defaulting to one harness's CLI makes the other depend on
# it. Checked here rather than at the top so an unset variable blocks a commit
# under review instead of every bash call, and fails loudly rather than waving
# the commit through.
: "${COMMIT_REVIEW_CMD:?set it to a non-interactive reviewer, e.g. claude -p --allowedTools \"\" or omp -p --no-tools --no-session}"

PROMPT_FILE=$(mktemp -t commit-review)
trap 'rm -f "$PROMPT_FILE"' EXIT

cat > "$PROMPT_FILE" <<PROMPTEOF
You are reviewing writing that is about to be committed, against this project's
communication standards.

<standards>
$(cat "$STANDARDS")
</standards>

Review two things.

1. The commit message inside this shell command:

<command>
$CMD
</command>

2. The prose this commit adds — markdown and code comments:

<prose>
$PROSE
</prose>

Judge ONLY against the standards above. Ignore code correctness, naming, and formatting.
Be strict about: walk-up paragraphs and dramatic framing, hype, "not just A but B",
affirm-then-justify openers, editorialising lead-ins, describing negative space,
hidden assumptions stated as fact, and content that mattered to the conversation
but not to a future reader.

If nothing meaningfully violates the standards, reply with exactly: PASS
Otherwise reply with up to 5 findings, one line each, in the form:
  <file or "commit message"> - "<the offending phrase>" - <which rule it breaks>
No preamble. No praise. Do not suggest rewrites.
PROMPTEOF

# Unquoted on purpose: the variable carries a command and its flags, and this
# script targets bash 3.2, where arrays are unavailable.
REVIEW=$($COMMIT_REVIEW_CMD < "$PROMPT_FILE" 2>/dev/null)

[ -n "$REVIEW" ] || allow                                   # reviewer failed: fail open
printf '%s' "$REVIEW" | head -1 | grep -q '^PASS' && allow

printf '%s' "$HASH" > "$FLAG"
printf 'Communication-standards review found:\n\n%s\n\nRevise against docs/communication-standards.md and commit again; the revision is reviewed afresh. To override instead, re-run this exact command with the same staged content and it will go through unreviewed.' "$REVIEW" \
  | python3 -c 'import json,sys; print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":sys.stdin.read()}}))'
