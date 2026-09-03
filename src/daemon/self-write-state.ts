import type { FileSystem } from "../ports/filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
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
}

export function createSelfWriteState(inner: FileSystem): SelfWriteState {
  const ledger = createSelfWriteLedger(inner);
  return {
    fileSystem: new RecordingFileSystem(inner, ledger),
    shouldSuppress: (path) => ledger.shouldSuppress(path),
  };
}

const daemonState = createSelfWriteState(new NodeFileSystem());

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
