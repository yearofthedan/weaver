import { describe, expect, it } from "vitest";
import { conformanceSuite } from "./__testHelpers__/filesystem-conformance.js";
import { InMemoryFileSystem } from "./in-memory-filesystem.js";

conformanceSuite("InMemoryFileSystem", () => ({
  vfs: new InMemoryFileSystem(),
  root: "/workspace",
}));

describe("InMemoryFileSystem", () => {
  describe("realpath", () => {
    it("returns the input path unchanged for an existing file", () => {
      const vfs = new InMemoryFileSystem();
      vfs.writeFile("/some/path/file.ts", "");
      expect(vfs.realpath("/some/path/file.ts")).toBe("/some/path/file.ts");
    });

    it("returns a non-existent path unchanged", () => {
      const vfs = new InMemoryFileSystem();
      expect(vfs.realpath("/does/not/exist.ts")).toBe("/does/not/exist.ts");
    });
  });

  describe("stat", () => {
    it("treats a path as a directory when a child key exists under it", () => {
      const vfs = new InMemoryFileSystem();
      vfs.writeFile("/project/src/index.ts", "");
      expect(vfs.stat("/project/src").isDirectory()).toBe(true);
      expect(vfs.stat("/project").isDirectory()).toBe(true);
    });

    it("treats a path with a trailing slash as a directory", () => {
      const vfs = new InMemoryFileSystem();
      vfs.mkdir("/project/dist/");
      expect(vfs.stat("/project/dist/").isDirectory()).toBe(true);
    });

    it("does not report a stale mtimeMs for a path removed by rename", () => {
      const vfs = new InMemoryFileSystem();
      vfs.writeFile("/project/stale-src.txt", "content");
      vfs.rename("/project/stale-src.txt", "/project/stale-dst.txt");
      expect(() => vfs.stat("/project/stale-src.txt")).toThrow();
    });

    it("does not report a stale mtimeMs for a path removed by unlink", () => {
      const vfs = new InMemoryFileSystem();
      vfs.writeFile("/project/stale-unlink.txt", "content");
      vfs.unlink("/project/stale-unlink.txt");
      expect(() => vfs.stat("/project/stale-unlink.txt")).toThrow();
    });
  });

  describe("mkdir", () => {
    it("stores a marker that exists() recognises without a trailing slash", () => {
      const vfs = new InMemoryFileSystem();
      vfs.mkdir("/project/logs");
      expect(vfs.exists("/project/logs")).toBe(true);
    });

    it("stamps the created directory with a positive mtimeMs, queryable without a trailing slash", () => {
      const vfs = new InMemoryFileSystem();
      vfs.mkdir("/project/logs");
      expect(vfs.stat("/project/logs").mtimeMs).toBeGreaterThan(0);
    });
  });

  describe("exists", () => {
    it("returns false for a directory-like path when no child keys share that prefix", () => {
      const vfs = new InMemoryFileSystem();
      // /alpha/beta has no children, and no marker — must not match /alpha
      vfs.writeFile("/alpha/beta", "");
      expect(vfs.exists("/alph")).toBe(false);
    });

    it("matches child keys by prefix, not suffix", () => {
      const vfs = new InMemoryFileSystem();
      // /x/y/z starts with /x/y/ but does not end with /x/y/
      vfs.writeFile("/x/y/z", "");
      expect(vfs.exists("/x/y")).toBe(true);
      expect(vfs.exists("/y")).toBe(false);
    });
  });

  describe("rename", () => {
    it("throws when the source path does not exist", () => {
      const vfs = new InMemoryFileSystem();
      expect(() => vfs.rename("/no/such/file.ts", "/dst.ts")).toThrow();
    });

    it("stamps the destination with a fresh mtimeMs greater than the source's original stamp", () => {
      const vfs = new InMemoryFileSystem();
      vfs.writeFile("/project/src.ts", "content");
      const before = vfs.stat("/project/src.ts").mtimeMs;
      vfs.rename("/project/src.ts", "/project/dst.ts");
      expect(vfs.stat("/project/dst.ts").mtimeMs).toBeGreaterThan(before);
    });

    it("moves only the renamed directory's own subtree, leaving a sibling alone", () => {
      const vfs = new InMemoryFileSystem();
      vfs.writeFile("/project/utils/a.ts", "a");
      vfs.writeFile("/project/other/b.ts", "b");

      vfs.rename("/project/utils", "/project/lib");

      expect(vfs.readFile("/project/lib/a.ts")).toBe("a");
      expect(vfs.readFile("/project/other/b.ts")).toBe("b");
      expect(vfs.exists("/project/lib/b.ts")).toBe(false);
    });

    it("stamps each file carried along by a directory rename", () => {
      const vfs = new InMemoryFileSystem();
      vfs.writeFile("/project/utils/a.ts", "a");
      const before = vfs.stat("/project/utils/a.ts").mtimeMs;

      vfs.rename("/project/utils", "/project/lib");

      expect(vfs.stat("/project/lib/a.ts").mtimeMs).toBeGreaterThan(before);
    });

    it("renames a directory that has no children, which exists only as its own marker", () => {
      const vfs = new InMemoryFileSystem();
      vfs.mkdir("/project/empty");

      vfs.rename("/project/empty", "/project/moved");

      expect(vfs.exists("/project/moved")).toBe(true);
      expect(vfs.stat("/project/moved").isDirectory()).toBe(true);
      expect(vfs.stat("/project/moved").mtimeMs).toBeGreaterThan(0);
    });
  });
});
