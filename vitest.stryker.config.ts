import { defineConfig } from "vitest/config";

// Vitest config for Stryker's mutation sandbox.
// Excludes tests that spawn CLI/daemon/MCP subprocesses — those binaries are
// not built in Stryker's sandbox. All other tests are safe to include.
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    include: ["tests/**/*.test.ts"],
    exclude: [
      // No dist/ binary in Stryker's sandbox — these tests spawn subprocesses
      "src/__testHelpers__/**",
      "tests/cli-workspace-default.test.ts",
      "tests/daemon/daemon.test.ts",
      "tests/daemon/protocol-version.test.ts",
      "tests/daemon/run-functions.test.ts",
      "tests/daemon/serve.test.ts",
      "tests/daemon/stop.test.ts",
      "tests/daemon/stop-daemon.test.ts",
      "tests/daemon/watcher.test.ts",
      "tests/mcp/find-references.test.ts",
      "tests/mcp/get-definition.test.ts",
      "tests/mcp/move-file.test.ts",
      "tests/mcp/move-symbol.test.ts",
      "tests/mcp/rename.test.ts",
      "tests/mcp/run-serve.test.ts",
      "tests/mcp/security.test.ts",
    ],
  },
});
