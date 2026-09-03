import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { createSelfWriteLedger } from "./self-write-ledger.js";

describe("self-write ledger", () => {
  describe("unrecorded paths", () => {
    it("never suppresses a path that was never recorded", () => {
      const fs = new InMemoryFileSystem();
      const ledger = createSelfWriteLedger(fs);

      expect(ledger.shouldSuppress("/workspace/never-touched.ts")).toBe(false);
    });
  });

  describe("recording a write", () => {
    it("suppresses an event for a path whose mtime still matches the recorded stamp", () => {
      const fs = new InMemoryFileSystem();
      const path = "/workspace/a.ts";
      fs.writeFile(path, "content");

      const ledger = createSelfWriteLedger(fs);
      ledger.recordWrite(path);

      expect(ledger.shouldSuppress(path)).toBe(true);
    });

    it("does not suppress once the file has been written again after the recorded stamp", () => {
      const fs = new InMemoryFileSystem();
      const path = "/workspace/b.ts";
      fs.writeFile(path, "content");

      const ledger = createSelfWriteLedger(fs);
      ledger.recordWrite(path);

      fs.writeFile(path, "edited externally");

      expect(ledger.shouldSuppress(path)).toBe(false);
    });

    it("consumes the entry once matched, so a second check on the same untouched file no longer suppresses", () => {
      const fs = new InMemoryFileSystem();
      const path = "/workspace/c.ts";
      fs.writeFile(path, "content");

      const ledger = createSelfWriteLedger(fs);
      ledger.recordWrite(path);

      expect(ledger.shouldSuppress(path)).toBe(true);
      expect(ledger.shouldSuppress(path)).toBe(false);
    });

    it("records nothing when the path has already vanished by the time it is stamped", () => {
      const fs = new InMemoryFileSystem();
      const ledger = createSelfWriteLedger(fs);

      ledger.recordWrite("/workspace/gone-before-stamp.ts");

      expect(ledger.shouldSuppress("/workspace/gone-before-stamp.ts")).toBe(false);
    });

    it("does not suppress when the recorded path is later removed rather than rewritten", () => {
      const fs = new InMemoryFileSystem();
      const path = "/workspace/d.ts";
      fs.writeFile(path, "content");

      const ledger = createSelfWriteLedger(fs);
      ledger.recordWrite(path);
      fs.unlink(path);

      expect(ledger.shouldSuppress(path)).toBe(false);
    });
  });

  describe("recording a removal", () => {
    it("suppresses an event for a path that is still absent", () => {
      const fs = new InMemoryFileSystem();
      const path = "/workspace/e.ts";
      fs.writeFile(path, "content");
      fs.unlink(path);

      const ledger = createSelfWriteLedger(fs);
      ledger.recordRemoval(path);

      expect(ledger.shouldSuppress(path)).toBe(true);
    });

    it("does not suppress when the path exists again by the time the event arrives", () => {
      const fs = new InMemoryFileSystem();
      const path = "/workspace/f.ts";
      fs.writeFile(path, "content");
      fs.unlink(path);

      const ledger = createSelfWriteLedger(fs);
      ledger.recordRemoval(path);

      fs.writeFile(path, "recreated externally");

      expect(ledger.shouldSuppress(path)).toBe(false);
    });

    it("consumes the entry once matched, so a second removal check no longer suppresses", () => {
      const fs = new InMemoryFileSystem();
      const path = "/workspace/g.ts";
      fs.writeFile(path, "content");
      fs.unlink(path);

      const ledger = createSelfWriteLedger(fs);
      ledger.recordRemoval(path);

      expect(ledger.shouldSuppress(path)).toBe(true);
      expect(ledger.shouldSuppress(path)).toBe(false);
    });
  });

  describe("bounded size", () => {
    it("evicts the oldest entry once the cap is exceeded, keeping the newest", () => {
      const fs = new InMemoryFileSystem();
      const ledger = createSelfWriteLedger(fs);
      const pathFor = (i: number) => `/workspace/bulk-${i}.ts`;
      const entryCount = 1001; // one past the ledger's cap

      for (let i = 0; i < entryCount; i++) {
        const path = pathFor(i);
        fs.writeFile(path, `content-${i}`);
        ledger.recordWrite(path);
      }

      expect(ledger.shouldSuppress(pathFor(0))).toBe(false);
      expect(ledger.shouldSuppress(pathFor(entryCount - 1))).toBe(true);
    });

    it("treats a re-recorded path as the newest, so eviction does not reclaim it", () => {
      const fs = new InMemoryFileSystem();
      const ledger = createSelfWriteLedger(fs);
      const pathFor = (i: number) => `/workspace/bulk-${i}.ts`;
      const veteran = "/workspace/written-twice.ts";

      const recordBulk = (i: number) => {
        fs.writeFile(pathFor(i), `content-${i}`);
        ledger.recordWrite(pathFor(i));
      };

      fs.writeFile(veteran, "first");
      ledger.recordWrite(veteran);
      for (let i = 0; i < 999; i++) recordBulk(i); // fills the ledger exactly to its cap

      // Rewriting moves it back to the newest position. Without that it stays
      // the oldest entry, and the write below evicts it instead of bulk-0.
      fs.writeFile(veteran, "second");
      ledger.recordWrite(veteran);

      recordBulk(999); // one past the cap, so exactly one entry is evicted

      expect(ledger.shouldSuppress(pathFor(0))).toBe(false);
      expect(ledger.shouldSuppress(veteran)).toBe(true);
    });
  });
});
