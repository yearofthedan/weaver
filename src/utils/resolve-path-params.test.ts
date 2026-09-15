import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  declaredPathValues,
  isTopLevelPathParam,
  resolveRelativePaths,
} from "./resolve-path-params.js";

describe("resolveRelativePaths", () => {
  it("resolves relative path params to absolute using workspace", () => {
    const params: Record<string, unknown> = { file: "src/utils.ts", line: 1 };
    resolveRelativePaths(params, ["file"], "/workspace");
    expect(params.file).toBe(path.join("/workspace", "src/utils.ts"));
  });

  it("leaves absolute paths unchanged", () => {
    const params: Record<string, unknown> = { file: "/abs/src/utils.ts" };
    resolveRelativePaths(params, ["file"], "/workspace");
    expect(params.file).toBe("/abs/src/utils.ts");
  });

  it("leaves non-string params unchanged", () => {
    const params: Record<string, unknown> = { line: 42 };
    resolveRelativePaths(params, ["line"], "/workspace");
    expect(params.line).toBe(42);
  });

  it("resolves multiple path params in one call", () => {
    const params: Record<string, unknown> = {
      oldPath: "src/a.ts",
      newPath: "src/b.ts",
    };
    resolveRelativePaths(params, ["oldPath", "newPath"], "/workspace");
    expect(params.oldPath).toBe(path.join("/workspace", "src/a.ts"));
    expect(params.newPath).toBe(path.join("/workspace", "src/b.ts"));
  });

  it("ignores path params not present in params object", () => {
    const params: Record<string, unknown> = { file: "src/a.ts" };
    resolveRelativePaths(params, ["file", "extra"], "/workspace");
    expect(params.file).toBe(path.join("/workspace", "src/a.ts"));
    expect(params.extra).toBeUndefined();
  });

  it("does not modify params when pathParams list is empty", () => {
    const params: Record<string, unknown> = { file: "src/a.ts" };
    resolveRelativePaths(params, [], "/workspace");
    expect(params.file).toBe("src/a.ts");
  });

  describe("nested declarations", () => {
    it("resolves a relative path inside an array element against the workspace", () => {
      const params: Record<string, unknown> = {
        edits: [
          { file: "src/a.ts", line: 1 },
          { file: "src/b.ts", line: 2 },
        ],
      };
      resolveRelativePaths(params, ["edits[].file"], "/workspace");
      expect(params.edits).toEqual([
        { file: path.join("/workspace", "src/a.ts"), line: 1 },
        { file: path.join("/workspace", "src/b.ts"), line: 2 },
      ]);
    });

    it("leaves an absolute path inside an array element unchanged", () => {
      const params: Record<string, unknown> = { edits: [{ file: "/abs/src/a.ts" }] };
      resolveRelativePaths(params, ["edits[].file"], "/workspace");
      expect(params.edits).toEqual([{ file: "/abs/src/a.ts" }]);
    });

    it("leaves a non-string element key unchanged", () => {
      const params: Record<string, unknown> = { edits: [{ file: 42 }, { file: null }] };
      resolveRelativePaths(params, ["edits[].file"], "/workspace");
      expect(params.edits).toEqual([{ file: 42 }, { file: null }]);
    });

    it("resolves nothing and does not throw when the array is missing", () => {
      const params: Record<string, unknown> = { pattern: "foo" };
      resolveRelativePaths(params, ["edits[].file"], "/workspace");
      expect(params).toEqual({ pattern: "foo" });
    });

    it("resolves nothing when the array is empty", () => {
      const params: Record<string, unknown> = { edits: [] };
      resolveRelativePaths(params, ["edits[].file"], "/workspace");
      expect(params.edits).toEqual([]);
    });

    it("ignores a declaration whose container is not an array", () => {
      const params: Record<string, unknown> = { edits: "src/a.ts" };
      resolveRelativePaths(params, ["edits[].file"], "/workspace");
      expect(params.edits).toBe("src/a.ts");
    });

    it("skips array entries that are not objects", () => {
      const params: Record<string, unknown> = { edits: ["src/a.ts", null, { file: "src/b.ts" }] };
      resolveRelativePaths(params, ["edits[].file"], "/workspace");
      expect(params.edits).toEqual([
        "src/a.ts",
        null,
        { file: path.join("/workspace", "src/b.ts") },
      ]);
    });

    it("resolves flat and nested declarations in one call", () => {
      const params: Record<string, unknown> = {
        file: "src/flat.ts",
        edits: [{ file: "src/nested.ts" }],
      };
      resolveRelativePaths(params, ["file", "edits[].file"], "/workspace");
      expect(params.file).toBe(path.join("/workspace", "src/flat.ts"));
      expect(params.edits).toEqual([{ file: path.join("/workspace", "src/nested.ts") }]);
    });
  });
});

describe("declaredPathValues", () => {
  it("returns the value of a flat declaration", () => {
    expect(declaredPathValues({ file: "src/a.ts" }, "file")).toEqual(["src/a.ts"]);
  });

  it("returns nothing for an absent or non-string flat declaration", () => {
    expect(declaredPathValues({ line: 1 }, "file")).toEqual([]);
    expect(declaredPathValues({ file: 1 }, "file")).toEqual([]);
  });

  it("returns the named key of every array element for a nested declaration", () => {
    const params = { edits: [{ file: "src/a.ts" }, { file: "src/b.ts" }] };
    expect(declaredPathValues(params, "edits[].file")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("omits array elements whose key is absent or not a string", () => {
    const params = { edits: [{ file: "src/a.ts" }, {}, { file: 3 }, "nope"] };
    expect(declaredPathValues(params, "edits[].file")).toEqual(["src/a.ts"]);
  });

  it("returns nothing when the nested array is missing or not an array", () => {
    expect(declaredPathValues({}, "edits[].file")).toEqual([]);
    expect(declaredPathValues({ edits: "src/a.ts" }, "edits[].file")).toEqual([]);
  });
});

describe("isTopLevelPathParam", () => {
  it("is true for a top-level declaration", () => {
    expect(isTopLevelPathParam("file")).toBe(true);
  });

  it("is false for a nested declaration", () => {
    expect(isTopLevelPathParam("edits[].file")).toBe(false);
  });
});
