#!/usr/bin/env bash
# PreToolUse(Bash) gate: critiques the prose in a staged commit — the commit
# message, added markdown, and added code comments — against
# docs/communication-standards.md, using a nested `claude -p` call.
#
# Findings block the attempt and record a hash of what was reviewed. Repeating
# that exact attempt — same command, same staged prose — is the override: the
# hash matches and it goes through. Change either, and it is reviewed afresh.
# A successful commit clears the record (see the PostToolUse hook in
# settings.local.json).
#
# Written for bash 3.2 (macOS): no heredoc inside $( ), no arrays, no ${x^^}.
set -uo pipefail

REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$REPO" ] || exit 0
STANDARDS="$REPO/docs/communication-standards.md"
FLAG="$REPO/.claude/hooks/.commit-review-blocked"   # holds the hash of the last rejected attempt
REVIEW_MODEL="${COMMIT_REVIEW_MODEL:-sonnet}"

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

REVIEW=$(claude -p --model "$REVIEW_MODEL" --allowedTools "" < "$PROMPT_FILE" 2>/dev/null)

[ -n "$REVIEW" ] || allow                                   # reviewer failed: fail open
printf '%s' "$REVIEW" | head -1 | grep -q '^PASS' && allow

printf '%s' "$HASH" > "$FLAG"
printf 'Communication-standards review found:\n\n%s\n\nRevise against docs/communication-standards.md and commit again; the revision is reviewed afresh. To override instead, re-run this exact command with the same staged content and it will go through unreviewed.' "$REVIEW" \
  | python3 -c 'import json,sys; print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":sys.stdin.read()}}))'
