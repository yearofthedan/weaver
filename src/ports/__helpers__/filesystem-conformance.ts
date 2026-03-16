import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileSystem } from "../../../src/ports/filesystem.js";

/**
 * Conformance test suite shared between all FileSystem implementations.
 * Call this from each implementation's test file, passing a factory that
 * produces a fresh instance and a writable root path for that test run.
 */
export function conformanceSuite(
  label: string,
  factory: () => { vfs: FileSystem; root: string; cleanup?: () => void },
) {
  describe(label, () => {
    let vfs: FileSystem;
    let root: string;
    let cleanup: (() => void) | undefined;

    beforeEach(() => {
      ({ vfs, root, cleanup } = factory());
    });

    afterEach(() => {
      cleanup?.();
    });

    describe("writeFile and readFile", () => {
      it("reads back the content written to a file", () => {
        const p = `${root}/hello.txt`;
        vfs.writeFile(p, "hello world");
        expect(vfs.readFile(p)).toBe("hello world");
      });

      it("overwrites existing content", () => {
        const p = `${root}/file.txt`;
        vfs.writeFile(p, "first");
        vfs.writeFile(p, "second");
        expect(vfs.readFile(p)).toBe("second");
      });

      it("throws when reading a non-existent file", () => {
        expect(() => vfs.readFile(`${root}/missing.txt`)).toThrow();
      });
    });

    describe("exists", () => {
      it("returns true for a file that has been written", () => {
        const p = `${root}/exists.txt`;
        vfs.writeFile(p, "data");
        expect(vfs.exists(p)).toBe(true);
      });

      it("returns false for a path that has not been written", () => {
        expect(vfs.exists(`${root}/no-such-file.txt`)).toBe(false);
      });
    });

    describe("mkdir", () => {
      it("creates a directory that exists can confirm", () => {
        const dir = `${root}/new-dir`;
        vfs.mkdir(dir);
        expect(vfs.exists(dir)).toBe(true);
      });

      it("creates nested directories with recursive option", () => {
        const dir = `${root}/a/b/c`;
        vfs.mkdir(dir, { recursive: true });
        expect(vfs.exists(dir)).toBe(true);
      });
    });

    describe("rename", () => {
      it("moves the file to the new path and removes the source", () => {
        const src = `${root}/src.txt`;
        const dst = `${root}/dst.txt`;
        vfs.writeFile(src, "move me");
        vfs.rename(src, dst);
        expect(vfs.exists(src)).toBe(false);
        expect(vfs.readFile(dst)).toBe("move me");
      });
    });

    describe("unlink", () => {
      it("removes a file so it no longer exists", () => {
        const p = `${root}/to-delete.txt`;
        vfs.writeFile(p, "bye");
        vfs.unlink(p);
        expect(vfs.exists(p)).toBe(false);
      });

      it("throws when unlinking a non-existent file", () => {
        expect(() => vfs.unlink(`${root}/ghost.txt`)).toThrow();
      });
    });

    describe("realpath", () => {
      it("returns a non-empty string for an existing file", () => {
        const p = `${root}/real.txt`;
        vfs.writeFile(p, "content");
        const result = vfs.realpath(p);
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
      });
    });

    describe("resolve", () => {
      it("resolves a single absolute path to itself", () => {
        expect(vfs.resolve("/a/b/c")).toBe("/a/b/c");
      });

      it("joins multiple segments into one path", () => {
        expect(vfs.resolve("/base", "sub", "file.ts")).toBe("/base/sub/file.ts");
      });

      it("normalises dot-dot segments", () => {
        expect(vfs.resolve("/a/b/../c")).toBe("/a/c");
      });
    });

    describe("stat", () => {
      it("reports a created directory as a directory", () => {
        const dir = `${root}/statdir`;
        vfs.mkdir(dir);
        expect(vfs.stat(dir).isDirectory()).toBe(true);
      });

      it("reports a written file as not a directory", () => {
        const p = `${root}/statfile.txt`;
        vfs.writeFile(p, "");
        expect(vfs.stat(p).isDirectory()).toBe(false);
      });
    });
  });
}
