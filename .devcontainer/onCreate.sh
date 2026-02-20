#!/bin/bash

# Fix permissions on folders after volumes are mounted
sudo chown -R node:node /home/node/.vscode-server ${containerWorkspaceFolder}

# Configure git identity from GitHub
if command -v gh &> /dev/null; then
  GH_USER=$(gh api user --jq .login 2>/dev/null)
  if [ -n "$GH_USER" ]; then
    # Prefer the no-reply email to keep personal email private in commits
    GH_EMAIL=$(gh api user/emails --jq '.[] | select(.email | contains("noreply.github.com")) | .email' 2>/dev/null)
    # Fallback to primary if no-reply is not found
    [ -z "$GH_EMAIL" ] && GH_EMAIL=$(gh api user/emails --jq '.[] | select(.primary==true) | .email' 2>/dev/null)

    git config user.name "$GH_USER"
    git config user.email "$GH_EMAIL"
    echo "✅ Git identity configured: $GH_USER <$GH_EMAIL>"
  fi
fi
