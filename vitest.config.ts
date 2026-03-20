import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000, // engine init (especially Volar) can be slow on first run
    include: ["src/**/*.test.ts"],
    exclude: ["src/__testHelpers__/**"],
    setupFiles: ["./src/__testHelpers__/test-cleanup.ts"],
  },
});
