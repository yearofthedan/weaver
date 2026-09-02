import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { RecordingFileSystem } from "./recording-filesystem.js";
import { createSelfWriteLedger } from "./self-write-ledger.js";

function setup() {
  const innerFs = new InMemoryFileSystem();
  const ledger = createSelfWriteLedger(innerFs);
  const recordingFs = new RecordingFileSystem(innerFs, ledger);
  return { innerFs, ledger, recordingFs };
}

describe("RecordingFileSystem", () => {
  describe("forwarding reads", () => {
    it("reads file content through the wrapped filesystem", () => {
      const { innerFs, recordingFs } = setup();
      innerFs.writeFile("/workspace/read.ts", "hello");

      expect(recordingFs.readFile("/workspace/read.ts")).toBe("hello");
    });

    it("reports existence through the wrapped filesystem", () => {
      const { innerFs, recordingFs } = setup();
      innerFs.writeFile("/workspace/present.ts", "content");

      expect(recordingFs.exists("/workspace/present.ts")).toBe(true);
      expect(recordingFs.exists("/workspace/absent.ts")).toBe(false);
    });

    it("reports directory classification through the wrapped filesystem", () => {
      const { innerFs, recordingFs } = setup();
      innerFs.mkdir("/workspace/adir");
      innerFs.writeFile("/workspace/afile.ts", "content");

      expect(recordingFs.stat("/workspace/adir").isDirectory()).toBe(true);
      expect(recordingFs.stat("/workspace/afile.ts").isDirectory()).toBe(false);
    });

    it("lists directory entries through the wrapped filesystem", () => {
      const { innerFs, recordingFs } = setup();
      innerFs.writeFile("/workspace/dir/a.ts", "a");
      innerFs.writeFile("/workspace/dir/b.ts", "b");

      expect(
        recordingFs
          .readdir("/workspace/dir")
          .map((e) => e.name)
          .sort(),
      ).toEqual(["a.ts", "b.ts"]);
    });

    it("resolves and realpaths through the wrapped filesystem", () => {
      const { recordingFs } = setup();

      expect(recordingFs.resolve("/a", "b.ts")).toBe("/a/b.ts");
      expect(recordingFs.realpath("/a/b.ts")).toBe("/a/b.ts");
    });
  });

  describe("recording a write", () => {
    it("suppresses the next event for the written path only", () => {
      const { ledger, recordingFs } = setup();

      recordingFs.writeFile("/workspace/x.ts", "content");

      expect(ledger.shouldSuppress("/workspace/x.ts")).toBe(true);
      expect(ledger.shouldSuppress("/workspace/untouched.ts")).toBe(false);
    });
  });

  describe("recording a directory creation", () => {
    it("suppresses the next event for the created directory path", () => {
      const { ledger, recordingFs } = setup();

      recordingFs.mkdir("/workspace/newdir");

      expect(ledger.shouldSuppress("/workspace/newdir")).toBe(true);
    });
  });

  describe("recording a removal", () => {
    it("suppresses the next event for the removed path while it stays absent", () => {
      const { innerFs, ledger, recordingFs } = setup();
      innerFs.writeFile("/workspace/gone.ts", "content");

      recordingFs.unlink("/workspace/gone.ts");

      expect(ledger.shouldSuppress("/workspace/gone.ts")).toBe(true);
    });
  });

  describe("recording a file rename", () => {
    it("suppresses removal at the old path and a write at the new path", () => {
      const { innerFs, ledger, recordingFs } = setup();
      innerFs.writeFile("/workspace/a.ts", "content");

      recordingFs.rename("/workspace/a.ts", "/workspace/b.ts");

      expect(ledger.shouldSuppress("/workspace/a.ts")).toBe(true);
      expect(ledger.shouldSuppress("/workspace/b.ts")).toBe(true);
    });
  });

  describe("recording a directory rename", () => {
    it("suppresses removal and write for every file in the moved subtree, at every depth", () => {
      const { innerFs, ledger, recordingFs } = setup();
      innerFs.writeFile("/workspace/olddir/top.ts", "top");
      innerFs.mkdir("/workspace/olddir/nested");
      innerFs.writeFile("/workspace/olddir/nested/deep.ts", "deep");
      innerFs.writeFile("/workspace/untouched.ts", "keep");

      recordingFs.rename("/workspace/olddir", "/workspace/newdir");

      expect(ledger.shouldSuppress("/workspace/olddir/top.ts")).toBe(true);
      expect(ledger.shouldSuppress("/workspace/newdir/top.ts")).toBe(true);
      expect(ledger.shouldSuppress("/workspace/olddir/nested/deep.ts")).toBe(true);
      expect(ledger.shouldSuppress("/workspace/newdir/nested/deep.ts")).toBe(true);
    });

    it("does not record a directory rename's own two directory paths, only its files", () => {
      const { innerFs, ledger, recordingFs } = setup();
      innerFs.writeFile("/workspace/olddir/top.ts", "top");

      recordingFs.rename("/workspace/olddir", "/workspace/newdir");

      expect(ledger.shouldSuppress("/workspace/olddir")).toBe(false);
      expect(ledger.shouldSuppress("/workspace/newdir")).toBe(false);
    });

    it("does not suppress a file outside the moved subtree", () => {
      const { innerFs, ledger, recordingFs } = setup();
      innerFs.writeFile("/workspace/olddir/top.ts", "top");
      innerFs.writeFile("/workspace/untouched.ts", "keep");

      recordingFs.rename("/workspace/olddir", "/workspace/newdir");

      expect(ledger.shouldSuppress("/workspace/untouched.ts")).toBe(false);
    });
  });
});
