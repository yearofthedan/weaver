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
    // MCP + daemon files that spawn CLI binaries: integration tests only,
    // not available in Stryker's sandbox — surviving mutants would confirm
    // test absence. ensure-daemon.ts has a pure unit-test suite and IS included.
    "!src/mcp.ts",
    "!src/daemon/daemon.ts",
    "!src/daemon/paths.ts",
    "!src/daemon/dispatcher.ts",
    "!src/daemon/watcher.ts",
  ],
  // Exclude MCP/daemon integration tests — they spawn CLI binaries that
  // aren't available in Stryker's sandbox.
  testFiles: [
    "tests/security/**/*.test.ts",
    "tests/utils/**/*.test.ts",
    "tests/operations/**/*.test.ts",
    "tests/providers/**/*.test.ts",
    // ensure-daemon unit tests: mock-based, no subprocess spawning
    "tests/daemon/ensure-daemon.test.ts",
    "tests/mcp/call-daemon-timeout.test.ts",
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
