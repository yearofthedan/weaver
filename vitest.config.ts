import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000, // engine init (especially Volar) can be slow on first run
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/fixtures/**"],
  },
});
