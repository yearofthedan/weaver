// @ts-check
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
const config = {
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  // Prepend `// @ts-nocheck` to source files only — NOT to fixture files.
  // The default (true) applies to `{test,src,lib}/**/*` which includes
  // `src/__testHelpers__/fixtures/`; prepending a line to fixture files
  // shifts line numbers and breaks tests that assert on line/col positions.
  disableTypeChecks: "src/!(__testHelpers__)/**/*.ts",
  vitest: {
    // Separate config that excludes subprocess-spawning tests (those tests need
    // the compiled dist/ binary which is not present in Stryker's sandbox).
    configFile: "vitest.stryker.config.ts",
    related: false,
  },
  mutate: [
    // Tier 1: high-value, fast tests — always in CI scope.
    "src/utils/**/*.ts",
    "src/domain/**/*.ts",
    "src/ports/**/*.ts",
    // Tier 2: core logic — add once Tier 1 cache is stable.
    // "src/ts-engine/**/*.ts",
    // "src/operations/**/*.ts",
    // Tier 3: heavy compiler, few tests — add last.
    // "src/plugins/**/*.ts",
    // "src/adapters/cli/**/*.ts",
    // "src/daemon/**/*.ts",
    // Global exclusions
    "!src/**/__testHelpers__/**",
  ],
  mutator: {
    excludedMutations: ["StringLiteral", "ArrayDeclaration"],
  },
  reporters: ["html", "json", "clear-text", "progress"],
  htmlReporter: {
    fileName: "reports/mutation/mutation.html",
  },
  jsonReporter: {
    fileName: "reports/mutation/mutation.json",
  },
  thresholds: {
    high: 80,
    low: 60,
    break: 75,
  },
  // pnpm's content-addressed store lives inside the project root in this dev
  // container. Stryker's sandbox copy follows symlinks and fails with ENOENT
  // when the link targets don't exist in the sandbox context.
  ignorePatterns: [".pnpm-store", "dist", "docs", "eval", ".husky", ".claude", ".github", ".devcontainer", "scripts"],
  incremental: true,
  coverageAnalysis: "perTest",
  timeoutMS: 120_000,
  concurrency: 2,
};

export default config;
