#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0

check() {
  local name="$1"
  local actual="$2"
  local expected="$3"
  if echo "$actual" | grep -q "$expected"; then
    printf "${GREEN}✓${NC} %s\n" "$name"
    PASS=$((PASS + 1))
  else
    printf "${RED}✗${NC} %s\n" "$name"
    printf "  expected: %s\n" "$expected"
    printf "  got:      %s\n" "$actual"
    FAIL=$((FAIL + 1))
  fi
}

check_absent() {
  local name="$1"
  local actual="$2"
  local unexpected="$3"
  if ! echo "$actual" | grep -q "$unexpected"; then
    printf "${GREEN}✓${NC} %s\n" "$name"
    PASS=$((PASS + 1))
  else
    printf "${RED}✗${NC} %s\n" "$name"
    printf "  expected NOT to find: %s\n" "$unexpected"
    FAIL=$((FAIL + 1))
  fi
}

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TSX="$ROOT_DIR/node_modules/.bin/tsx"
CLI="$ROOT_DIR/src/cli.ts"
FIXTURES="$ROOT_DIR/tests/fixtures"

if [[ ! -x "$TSX" ]]; then
  printf "${RED}error:${NC} tsx not found. Run: pnpm install\n"
  exit 1
fi

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

printf "\n${BOLD}light-bridge smoke test${NC}\n\n"

# ── rename ────────────────────────────────────────────────────────────────────
printf "${BOLD}rename:${NC} greetUser → greet (simple-ts)\n"

cp -r "$FIXTURES/simple-ts/." "$WORK_DIR/rename/"

OUTPUT=$(cd "$WORK_DIR/rename" && "$TSX" "$CLI" rename \
  --file src/utils.ts --line 1 --col 17 --newName greet 2>/dev/null)

check "returns ok:true"                   "$OUTPUT"                                '"ok":true'
check "reports filesModified"             "$OUTPUT"                                '"filesModified"'
check "utils.ts: function name updated"   "$(cat "$WORK_DIR/rename/src/utils.ts")" 'function greet('
check "main.ts: call site updated"        "$(cat "$WORK_DIR/rename/src/main.ts")"  'greet('
check_absent "greetUser removed"          "$(cat "$WORK_DIR/rename/src/utils.ts")" 'greetUser'

printf "\n"

# ── move ──────────────────────────────────────────────────────────────────────
printf "${BOLD}move:${NC} src/utils.ts → src/math.ts (multi-importer)\n"

cp -r "$FIXTURES/multi-importer/." "$WORK_DIR/move/"

OUTPUT=$(cd "$WORK_DIR/move" && "$TSX" "$CLI" move \
  --oldPath src/utils.ts --newPath src/math.ts 2>/dev/null)

check "returns ok:true"                   "$OUTPUT"                                '"ok":true'
check "reports filesModified"             "$OUTPUT"                                '"filesModified"'
check "math.ts exists at new path"        "$(ls "$WORK_DIR/move/src/")"            'math.ts'
check "featureA.ts: import updated"       "$(cat "$WORK_DIR/move/src/featureA.ts")" './math'
check "featureB.ts: import updated"       "$(cat "$WORK_DIR/move/src/featureB.ts")" './math'
check_absent "utils.ts removed"           "$(ls "$WORK_DIR/move/src/")"            'utils.ts'

printf "\n"

# ── summary ───────────────────────────────────────────────────────────────────
TOTAL=$((PASS + FAIL))
if [[ $FAIL -eq 0 ]]; then
  printf "${GREEN}${BOLD}All $TOTAL checks passed.${NC}\n\n"
else
  printf "${RED}${BOLD}$FAIL/$TOTAL checks failed.${NC}\n\n"
  exit 1
fi
