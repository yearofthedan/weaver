import { defineConfig } from "vitest/config";

// Vitest config for Stryker's mutation sandbox.
// Excludes tests that spawn CLI/daemon/MCP subprocesses — those binaries are
// not built in Stryker's sandbox. All other tests are safe to include.
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    exclude: [
      "src/__testHelpers__/**",
      "src/**/*.integration.test.ts",
      // dispatcher.ts is excluded from mutation (stryker.config.mjs). Its tests
      // redundantly cover getTypeErrors.ts mutants without killing unique ones.
      "src/daemon/dispatcher.test.ts",
    ],
  },
});
