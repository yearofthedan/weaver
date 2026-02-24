import { describe, expect, it } from "vitest";
import { computeRelativeImportPath } from "../../src/utils/relative-path.js";

describe("computeRelativeImportPath", () => {
  describe("TypeScript source extensions → .js runtime extension", () => {
    it(".ts → .js (same directory)", () => {
      expect(computeRelativeImportPath("/project/src/a.ts", "/project/src/b.ts")).toBe("./b.js");
    });

    it(".tsx → .js", () => {
      expect(computeRelativeImportPath("/project/src/a.ts", "/project/src/comp.tsx")).toBe(
        "./comp.js",
      );
    });

    it(".jsx → .js", () => {
      expect(computeRelativeImportPath("/project/src/a.ts", "/project/src/comp.jsx")).toBe(
        "./comp.js",
      );
    });

    it(".mts → .mjs", () => {
      expect(computeRelativeImportPath("/project/src/a.ts", "/project/src/worker.mts")).toBe(
        "./worker.mjs",
      );
    });

    it(".cts → .cjs", () => {
      expect(computeRelativeImportPath("/project/src/a.ts", "/project/src/legacy.cts")).toBe(
        "./legacy.cjs",
      );
    });
  });

  describe("JavaScript runtime extensions → unchanged", () => {
    it(".js → .js (kept, not stripped)", () => {
      expect(computeRelativeImportPath("/project/src/a.ts", "/project/src/utils.js")).toBe(
        "./utils.js",
      );
    });

    it(".mjs → .mjs", () => {
      expect(computeRelativeImportPath("/project/src/a.ts", "/project/src/worker.mjs")).toBe(
        "./worker.mjs",
      );
    });

    it(".cjs → .cjs", () => {
      expect(computeRelativeImportPath("/project/src/a.ts", "/project/src/legacy.cjs")).toBe(
        "./legacy.cjs",
      );
    });
  });

  describe("non-TS extensions → left untouched", () => {
    it(".vue → unchanged", () => {
      expect(computeRelativeImportPath("/project/src/a.ts", "/project/src/App.vue")).toBe(
        "./App.vue",
      );
    });

    it(".json → unchanged", () => {
      expect(computeRelativeImportPath("/project/src/a.ts", "/project/src/data.json")).toBe(
        "./data.json",
      );
    });
  });

  describe("path shape", () => {
    it("parent-directory specifier", () => {
      expect(computeRelativeImportPath("/project/src/sub/a.ts", "/project/src/utils.ts")).toBe(
        "../utils.js",
      );
    });

    it("child-directory specifier", () => {
      expect(computeRelativeImportPath("/project/src/a.ts", "/project/src/utils/helpers.ts")).toBe(
        "./utils/helpers.js",
      );
    });

    it("always starts with ./ or ../", () => {
      const result = computeRelativeImportPath("/project/src/a.ts", "/project/src/b.ts");
      expect(result.startsWith(".")).toBe(true);
    });

    it("index file keeps the index filename (no directory collapse)", () => {
      expect(computeRelativeImportPath("/project/src/a.ts", "/project/src/utils/index.ts")).toBe(
        "./utils/index.js",
      );
    });
  });
});
