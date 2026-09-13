import { describe, expect, it } from "vitest";
import { stripExt } from "./extensions.js";

describe("stripExt", () => {
  it.each([
    { src: "a.ts", expected: "a", desc: "strips .ts" },
    { src: "a.tsx", expected: "a", desc: "strips .tsx" },
    { src: "a.mts", expected: "a", desc: "strips .mts" },
    { src: "a.cts", expected: "a", desc: "strips .cts" },
    { src: "a.js", expected: "a", desc: "strips .js" },
    { src: "a.jsx", expected: "a", desc: "strips .jsx" },
    {
      src: "composables/useCounter.ts",
      expected: "composables/useCounter",
      desc: "keeps the path",
    },
    { src: "a.b.ts", expected: "a.b", desc: "strips one trailing extension" },
  ])("$desc", ({ src, expected }) => {
    expect(stripExt(src)).toBe(expected);
  });

  it("keeps a source extension that is not the trailing one", () => {
    expect(stripExt("a.ts.bak")).toBe("a.ts.bak");
    expect(stripExt("a.ts.txt")).toBe("a.ts.txt");
  });

  it("keeps a path with no source extension", () => {
    expect(stripExt("README.md")).toBe("README.md");
    expect(stripExt("mjs")).toBe("mjs");
  });
});
