// @ts-check
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  disableTypeChecks: false,
  vitest: { configFile: "vitest.config.ts", related: false },
  mutate: ["src/daemon/ensure-daemon.ts"],
  testFiles: [
    "tests/daemon/ensure-daemon.test.ts",
    "tests/mcp/call-daemon-timeout.test.ts",
  ],
  mutator: { excludedMutations: ["StringLiteral", "ArrayDeclaration"] },
  reporters: ["clear-text", "progress"],
  thresholds: { high: 80, low: 60, break: 75 },
  coverageAnalysis: "off",
  timeoutMS: 60_000,
  concurrency: 2,
};
