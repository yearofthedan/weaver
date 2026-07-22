import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileSystem } from "../filesystem.js";

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

    describe("readdir", () => {
      it("lists immediate child files by basename, classified as files", () => {
        vfs.writeFile(`${root}/a.txt`, "");
        vfs.writeFile(`${root}/b.txt`, "");
        const entries = vfs.readdir(root);
        expect(entries.map((e) => e.name).sort()).toEqual(["a.txt", "b.txt"]);
        expect(entries.every((e) => e.isFile() && !e.isDirectory())).toBe(true);
      });

      it("lists a child directory once, classified as a directory, without recursing", () => {
        vfs.mkdir(`${root}/sub`);
        vfs.writeFile(`${root}/sub/c.txt`, "");
        vfs.writeFile(`${root}/sub/d.txt`, "");
        const entries = vfs.readdir(root);
        const names = entries.map((e) => e.name);
        expect(names).toContain("sub");
        expect(names).not.toContain("c.txt");
        expect(names.filter((n) => n === "sub")).toHaveLength(1);
        const sub = entries.find((e) => e.name === "sub");
        expect(sub?.isDirectory()).toBe(true);
        expect(sub?.isFile()).toBe(false);
      });

      it("returns an empty list for a freshly created directory", () => {
        // Guards the directory's own marker key from leaking in as a phantom "" entry.
        const dir = `${root}/empty-dir`;
        vfs.mkdir(dir);
        expect(vfs.readdir(dir)).toEqual([]);
      });

      it("throws when the path does not exist", () => {
        expect(() => vfs.readdir(`${root}/missing-dir`)).toThrow();
      });

      it("throws when the path is a file, not a directory", () => {
        const p = `${root}/afile.txt`;
        vfs.writeFile(p, "");
        expect(() => vfs.readdir(p)).toThrow();
      });
    });
  });
}
