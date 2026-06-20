import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FileSystem } from "../ports/filesystem.js";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
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

    it("returns true for a path that does not exist on disk (lexically inside)", () => {
      const scope = new WorkspaceScope(ROOT, new InMemoryFileSystem());
      expect(scope.contains("/workspace/src/does-not-exist.ts")).toBe(true);
    });

    it("fails closed (returns false) when realpath throws for an existing path", () => {
      const vfs = new InMemoryFileSystem();
      vfs.writeFile("/workspace/src/file.ts", "");
      const throwingRealpath = new Proxy(vfs, {
        get(target, prop) {
          if (prop === "realpath") {
            return () => {
              throw new Error("ELOOP");
            };
          }
          return (target as Record<string | symbol, unknown>)[prop];
        },
      }) as FileSystem;
      const scope = new WorkspaceScope(ROOT, throwingRealpath);
      expect(scope.contains("/workspace/src/file.ts")).toBe(false);
    });

    describe("symlink resolution via injected FileSystem", () => {
      const tmpDirs: string[] = [];

      afterEach(() => {
        for (const d of tmpDirs.splice(0)) {
          fs.rmSync(d, { recursive: true, force: true });
        }
      });

      function makeTmpDir(): string {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), "ws-scope-"));
        tmpDirs.push(d);
        return d;
      }

      it("rejects a symlink inside the workspace that resolves outside", () => {
        const workspace = makeTmpDir();
        const outside = makeTmpDir();
        const outsideFile = path.join(outside, "secret.ts");
        fs.writeFileSync(outsideFile, "");
        const link = path.join(workspace, "escape.ts");
        fs.symlinkSync(outsideFile, link);
        const scope = new WorkspaceScope(workspace, new NodeFileSystem());
        expect(scope.contains(link)).toBe(false);
      });

      it("accepts a regular file that exists inside the workspace", () => {
        const workspace = makeTmpDir();
        const file = path.join(workspace, "src", "index.ts");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "");
        const scope = new WorkspaceScope(workspace, new NodeFileSystem());
        expect(scope.contains(file)).toBe(true);
      });
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
