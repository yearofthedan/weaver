// @ts-check
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
const config = {
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  // Must be false — the default (true) prepends `// @ts-nocheck` to files in
  // the sandbox, which shifts line numbers and breaks tests that assert on
  // line/col positions (searchText, replaceText surgical mode, rename).
  disableTypeChecks: false,
  vitest: {
    configFile: "vitest.config.ts",
    related: false,
  },
  mutate: [
    "src/**/*.ts",
    // Declarative / entry-point files: no logic to mutate
    "!src/cli.ts",
    "!src/schema.ts",
    "!src/types.ts",
    // Daemon + MCP: line coverage too low — surviving mutants would just
    // confirm test absence, not real gaps
    "!src/mcp.ts",
    "!src/daemon/**/*.ts",
  ],
  // Exclude MCP/daemon integration tests — they spawn CLI binaries that
  // aren't available in Stryker's sandbox.
  testFiles: [
    "tests/security/**/*.test.ts",
    "tests/utils/**/*.test.ts",
    "tests/operations/**/*.test.ts",
    "tests/providers/**/*.test.ts",
  ],
  mutator: {
    excludedMutations: ["StringLiteral", "ArrayDeclaration"],
  },
  reporters: ["html", "clear-text", "progress"],
  htmlReporter: {
    fileName: "reports/mutation/mutation.html",
  },
  thresholds: {
    high: 80,
    low: 60,
    break: 75,
  },
  coverageAnalysis: "off",
  timeoutMS: 120_000,
  concurrency: 2,
};

export default config;
