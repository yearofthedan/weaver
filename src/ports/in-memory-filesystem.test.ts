import { describe, expect, it } from "vitest";
import { conformanceSuite } from "./__helpers__/filesystem-conformance.js";
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
  });

  describe("mkdir", () => {
    it("stores a marker that exists() recognises without a trailing slash", () => {
      const vfs = new InMemoryFileSystem();
      vfs.mkdir("/project/logs");
      expect(vfs.exists("/project/logs")).toBe(true);
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
  });
});
