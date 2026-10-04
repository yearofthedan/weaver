#!/usr/bin/env bash
# commit-msg gate: two phases over the prose a commit introduces — its subject
# line, added markdown, and added code comments.
#
# 1. Mechanical. The literal phrases in docs/communication-phrases.txt reject
#    the commit. Same input, same verdict, every time.
# 2. Model review. The same prose is judged against
#    docs/communication-standards.md and the findings are printed, but the
#    commit proceeds. A sampled verdict cannot gate anything: a revision
#    re-rolls it, so the gate turns a style note into a reject loop.
#
# commit-msg fires with the index staged and before the commit object exists, so
# the reviewed content is the committed content, and any commit is covered
# whatever made it.
#
# Written for bash 3.2 (macOS): no heredoc inside $( ), no arrays, no ${x^^}.
set -uo pipefail

# A COMMIT_REVIEW_CMD already set in the environment picks the runner and model.
COMMIT_REVIEW_CMD="${COMMIT_REVIEW_CMD:-omp -p --model deepseek/deepseek-v4.1-flash --no-tools --no-session}"

MSG_FILE="${1:-}"
REPO=$(git rev-parse --show-toplevel 2>/dev/null)
[ -n "$REPO" ] || exit 0

STANDARDS="$REPO/docs/communication-standards.md"
PHRASES="$REPO/docs/communication-phrases.txt"

[ -n "$MSG_FILE" ] && [ -f "$MSG_FILE" ] || exit 0
[ -f "$STANDARDS" ] || exit 0

cd "$REPO" || exit 0

# Only the subject line. The body is a dated record whose job is to restate
# context a future reader lacks, which the living-doc rules for placement and
# relevance read as a fault.
SUBJECT=$(git stripspace --strip-comments < "$MSG_FILE" | head -1)

TMP=$(mktemp -d -t commit-review)
trap 'rm -rf "$TMP"' EXIT

# --- Phase 1: mechanical phrase check ----------------------------------------

if [ -f "$PHRASES" ]; then
  # Added prose with its line number in the staged file:
  # <path><TAB><line><TAB><text>.
  git diff --cached -U0 | awk '
    /^\+\+\+ / {
      path = substr($0, 7)
      sub(/^b\//, "", path)
      next
    }
    /^@@ / {
      match($0, /\+[0-9]+/)
      lineno = substr($0, RSTART + 1, RLENGTH - 1) + 0
      next
    }
    /^\+/ && !/^\+\+\+/ {
      text = substr($0, 2)
      body = text; sub(/^[ \t]*/, "", body)
      if (path ~ /\.(md|mdx|txt)$/ || body ~ /^(\/\/|\/\*|\*|#|<!--)/)
        print path "\t" lineno "\t" text
      lineno++
      next
    }
    /^-/ { next }   # a removed line never advances the new-file counter
  ' > "$TMP/added"

  # Per path, the added line numbers as ",1,4,9,".
  awk -F'\t' '{ n[$1] = n[$1] "," $2 } END { for (p in n) print p "\t" n[p] "," }' \
    "$TMP/added" > "$TMP/nums"

  # Added lines that carry prose: fenced blocks dropped, inline code spans and
  # quoted text removed so a page can name the phrases it bans.
  : > "$TMP/scan"
  while IFS="$(printf '\t')" read -r path nums; do
    case "$path" in
      docs/communication-phrases.txt) continue ;;   # the list names its own patterns
      *.md|*.mdx|*.txt) markdown=1 ;;
      *) markdown=0 ;;
    esac
    git show ":$path" 2>/dev/null | awk -v p="$path" -v nums="$nums" -v md="$markdown" '
      { n++ }
      md == 1 && /^[ \t]*(```|~~~)/ { fence = !fence; next }
      fence { next }
      {
        if (index(nums, "," n ",") == 0) next
        s = $0
        gsub(/`[^`]*`/, "", s)
        gsub(/"[^"]*"/, "", s)
        print p "\t" n "\t" s
      }
    ' >> "$TMP/scan"
  done < "$TMP/nums"

  printf 'subject\t0\t%s\n' "$SUBJECT" | awk '
    { gsub(/`[^`]*`/, ""); gsub(/"[^"]*"/, ""); print }
  ' >> "$TMP/scan"

  FINDINGS=$(awk -F'\t' '
    FILENAME == pf {
      if ($0 ~ /^#/ || $0 ~ /^[ \t]*$/) next
      pat[++np] = $1
      lbl[np] = $2
      next
    }
    {
      text = tolower($3)
      for (i = 1; i <= np; i++) {
        needle = tolower(pat[i])
        pos = 1
        while ((off = index(substr(text, pos), needle)) > 0) {
          at = pos + off - 1
          before = (at == 1) ? " " : substr(text, at - 1, 1)
          end = at + length(needle)
          after = (end > length(text)) ? " " : substr(text, end, 1)
          if (before !~ /[[:alnum:]]/ && after !~ /[[:alnum:]]/) {
            where = ($1 == "subject") ? "subject" : $1 ":" $2
            print where " - \"" pat[i] "\" - " lbl[i]
            break
          }
          pos = at + 1
        }
      }
    }
  ' pf="$PHRASES" "$PHRASES" "$TMP/scan")

  if [ -n "$FINDINGS" ]; then
    printf '\nBanned phrases in committed prose:\n\n%s\n\nReword them. If the use is legitimate, quote the phrase (inline code or quotation marks) so it reads as a mention, or drop the pattern from docs/communication-phrases.txt.\n' "$FINDINGS" >&2
    exit 1
  fi
else
  echo "commit phrase check skipped: docs/communication-phrases.txt is missing" >&2
fi

# --- Phase 2: model review, advisory -----------------------------------------

command -v "${COMMIT_REVIEW_CMD%% *}" >/dev/null 2>&1 || {
  echo "commit-standards review skipped: ${COMMIT_REVIEW_CMD%% *} is not on PATH" >&2
  exit 0
}

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

[ -n "$SUBJECT$PROSE" ] || exit 0

PROMPT_FILE="$TMP/prompt"

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
Otherwise report every finding, one line each, in the form:
  <file or "subject"> - "<the offending phrase>" - <which rule it breaks>
No preamble. No praise. Do not suggest rewrites.
PROMPTEOF

# Unquoted on purpose: the variable carries a command and its flags, and this
# script targets bash 3.2, where arrays are unavailable.
REVIEW=$($COMMIT_REVIEW_CMD < "$PROMPT_FILE" 2>/dev/null)

[ -n "$REVIEW" ] || exit 0                               # reviewer failed: fail open
printf '%s' "$REVIEW" | head -1 | grep -q '^PASS' && exit 0

printf '\nCommunication-standards review found:\n\n%s\n\nAdvisory only — the commit proceeds. Revise in a follow-up commit if the findings hold.\n' "$REVIEW" >&2
exit 0
