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
    "src/security.ts",
    "src/utils/errors.ts",
    "src/utils/text-utils.ts",
    "src/utils/file-walk.ts",
    "src/utils/relative-path.ts",
    "src/utils/assert-file.ts",
    "src/utils/ts-project.ts",
    "src/operations/searchText.ts",
    "src/operations/replaceText.ts",
    "src/operations/rename.ts",
    "src/operations/findReferences.ts",
    "src/operations/getDefinition.ts",
    "src/operations/moveFile.ts",
    "src/operations/moveSymbol.ts",
    "src/providers/ts.ts",
    "src/providers/vue-scan.ts",
    "src/providers/volar.ts",
    "src/providers/vue-service.ts",
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
