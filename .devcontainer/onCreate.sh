#!/bin/bash
REPO_URL="$1"

if [ -z "$REPO_URL" ]; then
  echo "❌ Error: No repository URL provided."
  exit 1
fi

echo "🔑 Fixing workspace permissions..."
sudo chown -R node:node .
sudo chown -R node:node /home/node/.vscode-server 2>/dev/null || true

# ⬇️ Pull the repo
if [ ! -d ".git" ]; then
    git init
    git remote add origin "$REPO_URL"
    git fetch
    git reset --hard origin/main
    git branch -M main
    git branch --set-upstream-to=origin/main main
fi

# 🚀 The Alias (This is the 'aee' part)
if ! grep -q "alias aee=" ~/.zshrc; then
  echo 'alias aee="zellij --layout .devcontainer/zellij-layout.kdl"' >> ~/.zshrc
fi

echo "✅ onCreate setup complete."fi
