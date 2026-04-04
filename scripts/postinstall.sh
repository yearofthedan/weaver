#!/usr/bin/env bash
# Register the weaver CLI locally after install so `pnpm exec weaver` works
# for dogfooding. Skipped in CI where the build runs separately.

if [ "$CI" = "true" ]; then
  exit 0
fi

pnpm build && ln -sf ../../dist/adapters/cli/cli.js node_modules/.bin/weaver
