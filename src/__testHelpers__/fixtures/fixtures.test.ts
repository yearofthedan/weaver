import * as fs from "node:fs";
import { describe, expect, onTestFinished } from "vitest";
import { fileExists, readFile } from "../helpers.js";
import { FIXTURES, fixtureTest as test } from "./fixtures.js";

describe("fixtureTest fixtures", () => {
  test("dir is a fresh empty temp directory and is removed after the test", ({ dir }) => {
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.readdirSync(dir)).toHaveLength(0);
    onTestFinished(() => {
      expect(fs.existsSync(dir)).toBe(false);
    });
  });

  describe("seedInlineFixture", () => {
    test("writes files with content and creates parent directories on demand", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": "{}",
        "src/nested/a.ts": "export {}",
      });

      expect(fileExists(dir, "tsconfig.json")).toBe(true);
      expect(readFile(dir, "tsconfig.json")).toBe("{}");

      expect(fileExists(dir, "src/nested/a.ts")).toBe(true);
      expect(readFile(dir, "src/nested/a.ts")).toBe("export {}");

      expect(fileExists(dir, "src/nested")).toBe(true);
    });

    test("returns the same dir on repeated calls within a test", async ({ seedInlineFixture }) => {
      const first = await seedInlineFixture({ "a.txt": "1" });
      const second = await seedInlineFixture({ "b.txt": "2" });
      expect(second).toBe(first);
      expect(readFile(first, "a.txt")).toBe("1");
      expect(readFile(first, "b.txt")).toBe("2");
    });

    test("is a no-op when called with an empty map", async ({ seedInlineFixture }) => {
      const dir = await seedInlineFixture({});
      expect(fs.readdirSync(dir)).toHaveLength(0);
    });
  });

  describe("seedNamedFixture", () => {
    test("copies a named fixture's directory tree into dir", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);

      const utilsContent = readFile(dir, "src/utils.ts");
      expect(utilsContent).toContain("export function greetUser");
      expect(utilsContent).toContain("Hello,");
      expect(fileExists(dir, "tsconfig.json")).toBe(true);
    });
  });

  describe("composition — seedNamedFixture then seedInlineFixture", () => {
    test("both helpers write into the same dir; later seedInlineFixture writes overwrite fixture files at the same path", async ({
      seedNamedFixture,
      seedInlineFixture,
    }) => {
      const fromNamed = await seedNamedFixture(FIXTURES.simpleTs.name);
      const fromInline = await seedInlineFixture({ "src/utils.ts": "OVERRIDDEN" });

      expect(fromInline).toBe(fromNamed);
      expect(readFile(fromNamed, "src/utils.ts")).toBe("OVERRIDDEN");
      expect(readFile(fromNamed, "src/main.ts")).toContain("greetUser");
    });
  });
});
