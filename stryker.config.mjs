// @ts-check
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
const config = {
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  inPlace: true,
  vitest: {
    configFile: "vitest.config.ts",
    related: false,
  },
  // Scope to code that works reliably under Stryker's vitest-runner.
  // Operations that use ts-morph / TypeScript's language service are excluded
  // because TS's module-level caches break under Stryker's thread pool.
  mutate: [
    "src/security.ts",
    "src/utils/text-utils.ts",
    "src/utils/file-walk.ts",
    "src/utils/relative-path.ts",
    "src/utils/assert-file.ts",
  ],
  testFiles: [
    "tests/security/**/*.test.ts",
    "tests/utils/**/*.test.ts",
  ],
  mutator: {
    excludedMutations: ["StringLiteral"],
  },
  reporters: ["html", "clear-text", "progress"],
  htmlReporter: {
    fileName: "reports/mutation/mutation.html",
  },
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
  coverageAnalysis: "off",
  timeoutMS: 120_000,
  concurrency: 2,
};

export default config;
