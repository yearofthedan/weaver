#!/bin/bash
#
# GitHub authentication and git identity setup.
#
# Two modes:
#   1. Pass-through: set GH_TOKEN + GH_USER + GH_EMAIL as container env vars
#   2. Interactive:  run this script manually after launching the container
#
# The script prefers env vars when present and falls back to interactive login.

set -euo pipefail

# --- Authentication ---

if [ -n "${GH_TOKEN:-}" ]; then
    echo "$GH_TOKEN" | gh auth login --with-token 2>/dev/null
    echo "Authenticated via GH_TOKEN."
elif gh auth status &>/dev/null; then
    echo "Already authenticated."
else
    echo "Authentication required for this session."
    gh auth login -h github.com -p https -w
fi

# --- Identity ---

GH_USER="${GH_USER:-$(gh api user -q '.login' 2>/dev/null || true)}"
GH_ID="${GH_ID:-$(gh api user -q '.id' 2>/dev/null || true)}"

if [ -n "$GH_USER" ]; then
    GH_EMAIL="${GH_EMAIL:-${GH_ID}+${GH_USER}@users.noreply.github.com}"
    git config --global user.name "$GH_USER"
    git config --global user.email "$GH_EMAIL"
    echo "Identity set: $GH_USER <$GH_EMAIL>"
else
    echo "Could not determine GitHub user. Git identity not configured."
    exit 1
fi
