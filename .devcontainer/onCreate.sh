#!/bin/bash

# Fix permissions on folders after volumes are mounted
sudo chown -R node:node /home/node/.vscode-server ${containerWorkspaceFolder}

# Authenticate with GitHub if needed
if ! gh auth status &>/dev/null; then
  echo "🔐 GitHub authentication required"
  # Use non-interactive login if GITHUB_TOKEN is available (e.g. for agents/CI)
  # Otherwise, use interactive device flow since browsers won't open in containers
  if [ -z "$GITHUB_TOKEN" ]; then
    gh auth login --hostname github.com --git-protocol https --web -s user -s repo
  else
    echo "Using GITHUB_TOKEN for authentication"
  fi
fi

# Pull code if it doesn't already exist
[ -d ".git" ] || git clone https://github.com/yearofthedan/light-bridge.git .

# Configure git identity from GitHub
GH_USER=$(gh api user --jq .login)
# Prefer the no-reply email to keep personal email private in commits
GH_EMAIL=$(gh api user/emails --jq '.[] | select(.email | contains("noreply.github.com")) | .email')
# Fallback to primary if no-reply is not found
[ -z "$GH_EMAIL" ] && GH_EMAIL=$(gh api user/emails --jq '.[] | select(.primary==true) | .email')

git config user.name "$GH_USER"
git config user.email "$GH_EMAIL"

echo "✅ Git identity configured: $GH_USER <$GH_EMAIL>"
