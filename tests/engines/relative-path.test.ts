import { describe, expect, it } from "vitest";
import { computeRelativeImportPath } from "../../src/utils/relative-path.js";

describe("computeRelativeImportPath", () => {
  it("produces a same-directory specifier with ./ prefix", () => {
    const result = computeRelativeImportPath("/project/src/a.ts", "/project/src/b.ts");
    expect(result).toBe("./b");
  });

  it("strips .tsx extension", () => {
    const result = computeRelativeImportPath("/project/src/a.ts", "/project/src/comp.tsx");
    expect(result).toBe("./comp");
  });

  it("strips .js extension", () => {
    const result = computeRelativeImportPath("/project/src/a.ts", "/project/src/utils.js");
    expect(result).toBe("./utils");
  });

  it("produces a parent-directory specifier", () => {
    const result = computeRelativeImportPath("/project/src/sub/a.ts", "/project/src/utils.ts");
    expect(result).toBe("../utils");
  });

  it("produces a child-directory specifier", () => {
    const result = computeRelativeImportPath("/project/src/a.ts", "/project/src/utils/helpers.ts");
    expect(result).toBe("./utils/helpers");
  });

  it("never returns a bare name without leading ./", () => {
    const result = computeRelativeImportPath("/project/src/a.ts", "/project/src/b.ts");
    expect(result.startsWith(".")).toBe(true);
  });

  it("handles files with no recognised extension (leaves path as-is)", () => {
    const result = computeRelativeImportPath("/project/src/a.ts", "/project/src/data.json");
    expect(result).toBe("./data.json");
  });
});
