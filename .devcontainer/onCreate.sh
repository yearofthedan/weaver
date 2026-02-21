#!/bin/bash
REPO_URL="$1"

if [ -z "$REPO_URL" ]; then
  echo "❌ Error: No repository URL provided to onCreate.sh."
  exit 1
fi

echo "🔑 Fixing workspace permissions..."
sudo chown -R node:node .
sudo chown -R node:node /home/node/.vscode-server 2>/dev/null || true

# Configure global git identity securely
if command -v gh &> /dev/null; then
  gh auth login --web --clipboard
  GH_USER=$(gh api user -q '.login' 2>/dev/null)
  GH_ID=$(gh api user -q '.id' 2>/dev/null)
  
  if [ -n "$GH_USER" ] && [ -n "$GH_ID" ]; then
    # Construct the email since the default scope doesn't have email access
    # and we don't want to get all the emails, then login again to remove the email scope
    GH_EMAIL="${GH_ID}+${GH_USER}@users.noreply.github.com"
    git config --global user.name "$GH_USER"
    git config --global user.email "$GH_EMAIL"
    echo "✅ Git identity securely configured: $GH_USER <$GH_EMAIL>"
  else
    echo "⚠️ Could not fetch Git identity from GitHub API. Skipping."
  fi
else
  echo "⚠️ GitHub CLI ('gh') not found. Skipping automatic Git identity setup."
fi


# Safely pull the dynamic repo into the workspace directory
if [ ! -d ".git" ]; then
    echo "⬇️ Pulling repository $REPO_URL into existing directory..."
    git init
    
    # Use the variable here!
    git remote add origin "$REPO_URL"
    git fetch
    
    git reset --hard origin/main
    git branch -M main
    git branch --set-upstream-to=origin/main main
    echo "✅ Repository cloned successfully!"
fi