#!/bin/bash

# Get latest claude
echo "updating Claude..."
curl -fsSL https://claude.ai/install.sh | bash || echo "⚠️ Claude update failed, continuing with existing version."

echo "Ready. Run 'scripts/bootstrap-gh.sh' to authenticate with GitHub."
