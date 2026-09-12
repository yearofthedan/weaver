import type { FileSystem } from "../ports/filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { evictDiagnosticParse } from "./language-plugin-registry.js";
import { RecordingFileSystem } from "./recording-filesystem.js";
import { createSelfWriteLedger } from "./self-write-ledger.js";

/**
 * A recording filesystem paired with the ledger it reports into. The two are
 * only useful together — a write recorded in one ledger tells another nothing
 * — so they are built and handed out as a unit.
 */
export interface SelfWriteState {
  /** Write through this and the mutation is recorded. */
  fileSystem: FileSystem;
  /** True when `path`'s watcher event came from a write through `fileSystem`. */
  shouldSuppress(path: string): boolean;
  /**
   * The paths mutated through `fileSystem` since the last call, each once. Draining clears the
   * record, so a repair driven from here follows every write the daemon makes.
   */
  drainPending(): string[];
}

export function createSelfWriteState(
  inner: FileSystem,
  onMutated: (path: string) => void = () => {},
): SelfWriteState {
  const ledger = createSelfWriteLedger(inner);
  const pending = new Set<string>();
  return {
    fileSystem: new RecordingFileSystem(inner, ledger, (path) => {
      pending.add(path);
      onMutated(path);
    }),
    shouldSuppress: (path) => ledger.shouldSuppress(path),
    drainPending: () => {
      const paths = [...pending];
      pending.clear();
      return paths;
    },
  };
}

/**
 * A retained diagnostic parse is only correct while it matches disk, and the
 * daemon's own writes are the main thing that moves disk. Evicting here rather
 * than at each call site means an operation cannot forget: every write the
 * daemon makes goes through this one instance. Which paths carry a parse is the
 * engine's to know, so every mutation is offered and the cache ignores the ones
 * it never held.
 */
const daemonState = createSelfWriteState(new NodeFileSystem(), evictDiagnosticParse);

/**
 * The one `FileSystem` every dispatcher operation writes through. Wrapping a
 * single shared instance — rather than each call site constructing its own
 * — is what lets the self-write ledger observe every mutation the daemon
 * makes, so the watcher can tell those apart from a genuine external edit.
 */
export function getSharedFileSystem(): FileSystem {
  return daemonState.fileSystem;
}

/**
 * True when `path`'s incoming watcher event is the daemon's own write and
 * the caller should skip invalidating.
 */
export function shouldSuppressSelfWrite(path: string): boolean {
  return daemonState.shouldSuppress(path);
}

/** The shared instance's pending mutations. */
export function drainPendingMutations(): string[] {
  return daemonState.drainPending();
}
