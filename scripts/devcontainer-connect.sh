#!/usr/bin/env bash
set -euo pipefail

if ! command -v devcontainer &>/dev/null; then
  echo "devcontainer CLI not found. Install it with:"
  echo "  npm install -g @devcontainers/cli"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
devcontainer exec --workspace-folder "$ROOT_DIR" zellij --layout .devcontainer/zellij-layout.kdl
