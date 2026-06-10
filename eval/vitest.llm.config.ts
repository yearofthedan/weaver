import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 120_000,
    include: ["eval/cases/**/*.llm.test.ts"],
    globalSetup: ["eval/global-setup.llm.ts"],
  },
});
