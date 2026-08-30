import { defineConfig } from "vitest/config";

// Vitest config for Stryker's mutation sandbox.
// Excludes tests that spawn CLI/daemon subprocesses — those binaries are
// not built in Stryker's sandbox. All other tests are safe to include.
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    // Only the fixture tree is excluded: it holds sample projects whose *.test.ts files are
    // fixture content, not tests. Real tests living beside helpers must still run, or code
    // they cover reports as unkilled in mutation runs.
    exclude: ["src/__testHelpers__/fixtures/*/**", "src/**/*.integration.test.ts"],
    // The engine registry keeps a process-wide singleton pinned to the first workspace
    // root it sees, so without the per-test reset this file performs, a suite's later
    // temp workspaces are invisible to it and behaviour that depends on the project
    // graph fails here while passing in the main lane.
    setupFiles: ["./src/__testHelpers__/test-cleanup.ts"],
  },
});
