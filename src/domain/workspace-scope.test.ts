import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { EngineError } from "./errors.js";
import { WorkspaceScope } from "./workspace-scope.js";

const ROOT = "/workspace";

describe("WorkspaceScope", () => {
  describe("contains()", () => {
    it.each([
      { path: "/workspace/src/index.ts", expected: true, label: "path inside the workspace" },
      { path: "/workspace", expected: true, label: "workspace root itself" },
      { path: "/other/file.ts", expected: false, label: "path outside the workspace" },
      {
        path: "/workspace/../etc/passwd",
        expected: false,
        label: "path traversing above root with ..",
      },
      {
        path: "/workspace-other/file.ts",
        expected: false,
        label: "sibling directory sharing a prefix",
      },
    ])("$label → $expected", ({ path: filePath, expected }) => {
      const scope = new WorkspaceScope(ROOT, new InMemoryFileSystem());
      expect(scope.contains(filePath)).toBe(expected);
    });
  });

  describe("recordModified()", () => {
    it("adds the path to modified", () => {
      const scope = new WorkspaceScope(ROOT, new InMemoryFileSystem());
      scope.recordModified("/workspace/a.ts");
      expect(scope.modified).toContain("/workspace/a.ts");
    });

    it("records each unique path only once", () => {
      const scope = new WorkspaceScope(ROOT, new InMemoryFileSystem());
      scope.recordModified("/workspace/a.ts");
      scope.recordModified("/workspace/a.ts");
      expect(scope.modified.filter((p) => p === "/workspace/a.ts")).toHaveLength(1);
    });

    it("does not add paths to skipped", () => {
      const scope = new WorkspaceScope(ROOT, new InMemoryFileSystem());
      scope.recordModified("/workspace/a.ts");
      expect(scope.skipped).toHaveLength(0);
    });
  });

  describe("recordSkipped()", () => {
    it("adds the path to skipped", () => {
      const scope = new WorkspaceScope(ROOT, new InMemoryFileSystem());
      scope.recordSkipped("/outside/b.ts");
      expect(scope.skipped).toContain("/outside/b.ts");
    });

    it("records each unique path only once", () => {
      const scope = new WorkspaceScope(ROOT, new InMemoryFileSystem());
      scope.recordSkipped("/outside/b.ts");
      scope.recordSkipped("/outside/b.ts");
      expect(scope.skipped.filter((p) => p === "/outside/b.ts")).toHaveLength(1);
    });

    it("does not add paths to modified", () => {
      const scope = new WorkspaceScope(ROOT, new InMemoryFileSystem());
      scope.recordSkipped("/outside/b.ts");
      expect(scope.modified).toHaveLength(0);
    });
  });

  describe("modified and skipped getters", () => {
    it("returns an array copy — mutating the result does not affect internal state", () => {
      const scope = new WorkspaceScope(ROOT, new InMemoryFileSystem());
      scope.recordModified("/workspace/a.ts");
      const result = scope.modified;
      result.push("/workspace/injected.ts");
      expect(scope.modified).toHaveLength(1);
    });

    it("returns a skipped array copy — mutating the result does not affect internal state", () => {
      const scope = new WorkspaceScope(ROOT, new InMemoryFileSystem());
      scope.recordSkipped("/outside/b.ts");
      const result = scope.skipped;
      result.push("/outside/injected.ts");
      expect(scope.skipped).toHaveLength(1);
    });

    it("modified starts empty", () => {
      const scope = new WorkspaceScope(ROOT, new InMemoryFileSystem());
      expect(scope.modified).toEqual([]);
    });

    it("skipped starts empty", () => {
      const scope = new WorkspaceScope(ROOT, new InMemoryFileSystem());
      expect(scope.skipped).toEqual([]);
    });
  });

  describe("fs property", () => {
    it("exposes the filesystem passed to the constructor", () => {
      const vfs = new InMemoryFileSystem();
      const scope = new WorkspaceScope(ROOT, vfs);
      expect(scope.fs).toBe(vfs);
    });
  });

  describe("writeFile()", () => {
    it("writes content to the filesystem for a path inside the workspace", () => {
      const vfs = new InMemoryFileSystem();
      const scope = new WorkspaceScope(ROOT, vfs);
      scope.writeFile("/workspace/out.ts", "hello");
      expect(vfs.readFile("/workspace/out.ts")).toBe("hello");
    });

    it("records the written path as modified", () => {
      const vfs = new InMemoryFileSystem();
      const scope = new WorkspaceScope(ROOT, vfs);
      scope.writeFile("/workspace/out.ts", "hello");
      expect(scope.modified).toContain("/workspace/out.ts");
    });

    it("does not add the written path to skipped", () => {
      const vfs = new InMemoryFileSystem();
      const scope = new WorkspaceScope(ROOT, vfs);
      scope.writeFile("/workspace/out.ts", "hello");
      expect(scope.skipped).toHaveLength(0);
    });

    it("throws EngineError with WORKSPACE_VIOLATION for a path outside the workspace", () => {
      const vfs = new InMemoryFileSystem();
      const scope = new WorkspaceScope(ROOT, vfs);
      expect(() => scope.writeFile("/outside/bad.ts", "content")).toThrowError(
        expect.objectContaining({ code: "WORKSPACE_VIOLATION" }),
      );
    });

    it("does not write to the filesystem when the path is outside the workspace", () => {
      const vfs = new InMemoryFileSystem();
      const scope = new WorkspaceScope(ROOT, vfs);
      try {
        scope.writeFile("/outside/bad.ts", "content");
      } catch {
        // expected
      }
      expect(vfs.exists("/outside/bad.ts")).toBe(false);
    });

    it("throws an EngineError instance (not a plain Error) for workspace violations", () => {
      const vfs = new InMemoryFileSystem();
      const scope = new WorkspaceScope(ROOT, vfs);
      expect(() => scope.writeFile("/outside/bad.ts", "x")).toThrow(EngineError);
    });
  });
});
