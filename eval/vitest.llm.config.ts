import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 120_000,
    include: ["eval/cases/**/*.llm.test.ts"],
    globalSetup: ["eval/global-setup.llm.ts"],
    // Case names are interpolated into test titles; the default 40-char
    // truncation makes long case names collide and breaks -t filtering.
    chaiConfig: { truncateThreshold: 0 },
  },
});
