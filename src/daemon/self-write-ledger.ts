import type { FileSystem } from "../ports/filesystem.js";

export interface SelfWriteLedger {
  recordWrite(path: string): void;
  recordRemoval(path: string): void;
  /** True when this event is the daemon's own write and should not invalidate. */
  shouldSuppress(path: string): boolean;
}

type LedgerEntry = { kind: "write"; mtimeMs: number } | { kind: "removal" };

/**
 * Upper bound on tracked paths, well above the largest realistic single
 * operation (~22 files measured on a real app; a directory move ten times
 * that size is still a few hundred). Eviction only engages on a
 * pathological run, never ordinary use.
 */
const MAX_ENTRIES = 1000;

/**
 * Tracks paths the daemon itself just wrote or removed, so the watcher can
 * tell its own writes apart from a genuine external edit and skip
 * invalidating compilers that are already correct.
 */
export function createSelfWriteLedger(fs: FileSystem): SelfWriteLedger {
  const entries = new Map<string, LedgerEntry>();

  function record(path: string, entry: LedgerEntry): void {
    entries.delete(path); // re-insert at the end so eviction order tracks recency
    entries.set(path, entry);
    if (entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
  }

  return {
    recordWrite(path: string): void {
      let mtimeMs: number;
      try {
        ({ mtimeMs } = fs.stat(path));
      } catch {
        // The path is already gone by the time we could stamp it. Leaving it
        // unrecorded means the next event for it invalidates rather than
        // being suppressed on the strength of a stamp that was never taken.
        return;
      }
      record(path, { kind: "write", mtimeMs });
    },

    recordRemoval(path: string): void {
      record(path, { kind: "removal" });
    },

    shouldSuppress(path: string): boolean {
      const entry = entries.get(path);
      if (!entry) return false;

      if (entry.kind === "removal") {
        if (fs.exists(path)) return false;
        entries.delete(path);
        return true;
      }

      let currentMtimeMs: number;
      try {
        ({ mtimeMs: currentMtimeMs } = fs.stat(path));
      } catch {
        // Recorded as written but now unreadable — something else removed
        // it, so this event is not the daemon's own write.
        return false;
      }
      if (currentMtimeMs !== entry.mtimeMs) return false;
      entries.delete(path);
      return true;
    },
  };
}
