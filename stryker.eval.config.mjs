// @ts-check
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
const config = {
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  disableTypeChecks: "eval/**/*.ts",
  vitest: {
    configFile: "vitest.stryker.eval.config.ts",
    related: false,
  },
  mutate: [
    "eval/harness/**/*.ts",
    "!eval/**/*.test.ts",
    // Content fixtures, not logic — see docs/tech/mutation-testing.md.
    "!eval/harness/clutter.ts",
    "!eval/harness/tools.ts",
  ],
  mutator: {
    excludedMutations: ["StringLiteral", "ArrayDeclaration"],
  },
  reporters: ["html", "json", "clear-text", "progress"],
  htmlReporter: {
    fileName: "reports/mutation-eval/mutation.html",
  },
  jsonReporter: {
    fileName: "reports/mutation-eval/mutation.json",
  },
  thresholds: {
    high: 80,
    low: 60,
    break: 75,
  },
  // src/ must stay in the sandbox: eval unit tests import OPERATION_NAMES from
  // the dispatcher. .claude/skills/ must too: skill-file/context tests read the
  // shipped SKILL.md bodies. Everything the eval tests don't need is ignored.
  ignorePatterns: [
    ".pnpm-store",
    "dist",
    "docs",
    ".husky",
    ".claude/agent-notes",
    ".claude/agent-memory",
    ".github",
    ".devcontainer",
    "scripts",
  ],
  incrementalFile: "reports/stryker-eval-incremental.json",
  incremental: true,
  coverageAnalysis: "perTest",
  timeoutMS: 120_000,
  concurrency: 2,
};

export default config;
