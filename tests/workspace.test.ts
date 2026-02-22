import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { isWithinWorkspace } from "../src/workspace.js";

describe("isWithinWorkspace", () => {
  const ws = "/tmp/my-workspace";

  it("returns true for a path inside the workspace", () => {
    expect(isWithinWorkspace("/tmp/my-workspace/src/foo.ts", ws)).toBe(true);
  });

  it("returns true for a path equal to the workspace root", () => {
    expect(isWithinWorkspace("/tmp/my-workspace", ws)).toBe(true);
  });

  it("returns false for a sibling directory that shares the workspace prefix", () => {
    // /tmp/my-workspace-other starts with /tmp/my-workspace but is NOT inside it
    expect(isWithinWorkspace("/tmp/my-workspace-other/file.ts", ws)).toBe(false);
  });

  it("returns false for a path in a completely different directory", () => {
    expect(isWithinWorkspace("/tmp/other/file.ts", ws)).toBe(false);
  });

  it("returns false for a path that resolves outside via ..", () => {
    // path.resolve normalises this to /tmp/other/file.ts
    expect(isWithinWorkspace("/tmp/my-workspace/../other/file.ts", ws)).toBe(false);
  });

  it("returns true for a deeply nested path", () => {
    expect(isWithinWorkspace("/tmp/my-workspace/a/b/c/d/index.ts", ws)).toBe(true);
  });

  it("returns false for the parent of the workspace", () => {
    expect(isWithinWorkspace("/tmp", ws)).toBe(false);
  });

  it("returns false for a root path", () => {
    expect(isWithinWorkspace("/", ws)).toBe(false);
  });

  it("handles absolute paths computed with path.join correctly", () => {
    const inside = path.join(ws, "src/index.ts");
    expect(isWithinWorkspace(inside, ws)).toBe(true);
  });
});
