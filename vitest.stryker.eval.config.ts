import { defineConfig } from "vitest/config";

// Vitest config for Stryker's mutation sandbox over the eval harness.
// Includes only the pure eval unit tests — the `.llm.test.ts` cases need the
// hosted model endpoint and are excluded.
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    include: ["eval/**/*.test.ts"],
    exclude: ["eval/cases/**/*.llm.test.ts"],
  },
});
