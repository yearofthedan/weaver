#!/usr/bin/env bash
# Dev-only: build and symlink so `pnpm exec weaver` works in this repo
# for dogfooding. Run manually after a fresh clone: `pnpm setup:dev`.

set -e
pnpm build
ln -sf ../../dist/adapters/cli/cli.js node_modules/.bin/weaver
