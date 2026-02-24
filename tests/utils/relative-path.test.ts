import { describe, expect, it } from "vitest";
import { computeRelativeImportPath } from "../../src/utils/relative-path.js";

describe("computeRelativeImportPath", () => {
  describe("TypeScript source extensions → .js runtime extension", () => {
    it.each([
      { src: "b.ts", expected: "./b.js", desc: ".ts → .js" },
      { src: "comp.tsx", expected: "./comp.js", desc: ".tsx → .js" },
      { src: "comp.jsx", expected: "./comp.js", desc: ".jsx → .js" },
      { src: "worker.mts", expected: "./worker.mjs", desc: ".mts → .mjs" },
      { src: "legacy.cts", expected: "./legacy.cjs", desc: ".cts → .cjs" },
    ])("$desc", ({ src, expected }) => {
      expect(computeRelativeImportPath("/project/src/a.ts", `/project/src/${src}`)).toBe(expected);
    });
  });

  describe("JavaScript runtime extensions → unchanged", () => {
    it.each([
      { src: "utils.js", expected: "./utils.js", desc: ".js kept" },
      { src: "worker.mjs", expected: "./worker.mjs", desc: ".mjs kept" },
      { src: "legacy.cjs", expected: "./legacy.cjs", desc: ".cjs kept" },
    ])("$desc", ({ src, expected }) => {
      expect(computeRelativeImportPath("/project/src/a.ts", `/project/src/${src}`)).toBe(expected);
    });
  });

  describe("non-TS extensions → left untouched", () => {
    it.each([
      { src: "App.vue", expected: "./App.vue", desc: ".vue unchanged" },
      { src: "data.json", expected: "./data.json", desc: ".json unchanged" },
    ])("$desc", ({ src, expected }) => {
      expect(computeRelativeImportPath("/project/src/a.ts", `/project/src/${src}`)).toBe(expected);
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
