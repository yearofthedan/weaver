import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRelativePaths } from "./resolve-path-params.js";

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
});
