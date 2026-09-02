import type { FileSystem } from "../ports/filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { RecordingFileSystem } from "./recording-filesystem.js";
import { createSelfWriteLedger } from "./self-write-ledger.js";

const innerFs = new NodeFileSystem();
const selfWriteLedger = createSelfWriteLedger(innerFs);
const sharedFs: FileSystem = new RecordingFileSystem(innerFs, selfWriteLedger);

/**
 * The one `FileSystem` every dispatcher operation writes through. Wrapping a
 * single shared instance — rather than each call site constructing its own
 * — is what lets the self-write ledger observe every mutation the daemon
 * makes, so the watcher can tell those apart from a genuine external edit.
 */
export function getSharedFileSystem(): FileSystem {
  return sharedFs;
}

/**
 * True when `path`'s incoming watcher event is the daemon's own write and
 * the caller should skip invalidating.
 */
export function shouldSuppressSelfWrite(path: string): boolean {
  return selfWriteLedger.shouldSuppress(path);
}
