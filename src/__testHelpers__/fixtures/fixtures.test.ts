import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, onTestFinished } from "vitest";
import { FIXTURES } from "./fixtures.js";
import { fixtureTest as test } from "./fixtures.js";

describe("fixtureTest fixtures", () => {
  describe("dir fixture — empty by default", () => {
    let capturedDir: string;

    test("provides a fresh empty temp directory", ({ dir }) => {
      capturedDir = dir;
      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.readdirSync(dir)).toHaveLength(0);
    });

    test("removes the temp directory after the test", () => {
      expect(capturedDir).toBeDefined();
      expect(fs.existsSync(capturedDir)).toBe(false);
    });
  });

  describe("seedInlineFixture", () => {
    test("writes files with content and creates parent directories on demand", async ({
      dir,
      seedInlineFixture,
    }) => {
      await seedInlineFixture({
        "tsconfig.json": "{}",
        "src/nested/a.ts": "export {}",
      });

      expect(fs.existsSync(path.join(dir, "tsconfig.json"))).toBe(true);
      expect(fs.readFileSync(path.join(dir, "tsconfig.json"), "utf8")).toBe("{}");

      expect(fs.existsSync(path.join(dir, "src/nested/a.ts"))).toBe(true);
      expect(fs.readFileSync(path.join(dir, "src/nested/a.ts"), "utf8")).toBe("export {}");

      expect(fs.existsSync(path.join(dir, "src/nested"))).toBe(true);
    });

    test("is a no-op when called with an empty map", async ({ dir, seedInlineFixture }) => {
      await seedInlineFixture({});
      expect(fs.readdirSync(dir)).toHaveLength(0);
    });
  });

  describe("seedNamedFixture", () => {
    test("copies a named fixture's directory tree into dir", async ({ dir, seedNamedFixture }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);

      const utilsContent = fs.readFileSync(path.join(dir, "src/utils.ts"), "utf8");
      expect(utilsContent).toContain("export function greetUser");
      expect(utilsContent).toContain("Hello,");
      expect(fs.existsSync(path.join(dir, "tsconfig.json"))).toBe(true);
    });
  });

  describe("composition — seedNamedFixture then seedInlineFixture", () => {
    test("later seedInlineFixture writes overwrite fixture files at the same path", async ({
      dir,
      seedNamedFixture,
      seedInlineFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      await seedInlineFixture({ "src/utils.ts": "OVERRIDDEN" });

      expect(fs.readFileSync(path.join(dir, "src/utils.ts"), "utf8")).toBe("OVERRIDDEN");

      const mainContent = fs.readFileSync(path.join(dir, "src/main.ts"), "utf8");
      expect(mainContent).toContain("greetUser");
    });
  });
});
