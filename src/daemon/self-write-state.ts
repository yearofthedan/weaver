import * as nodePath from "node:path";
import type { FileSystem } from "../ports/filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TS_EXTENSIONS } from "../utils/extensions.js";
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
}

export function createSelfWriteState(
  inner: FileSystem,
  onMutated: (path: string) => void = () => {},
): SelfWriteState {
  const ledger = createSelfWriteLedger(inner);
  return {
    fileSystem: new RecordingFileSystem(inner, ledger, onMutated),
    shouldSuppress: (path) => ledger.shouldSuppress(path),
  };
}

/**
 * A retained diagnostic parse is only correct while it matches disk, and the
 * daemon's own writes are the main thing that moves disk. Evicting here rather
 * than at each call site means an operation cannot forget: every write the
 * daemon makes goes through this one instance.
 *
 * Only source files carry a parse, so a `.md` or `.json` write costs nothing.
 * The extension set matches the one the importer rewrites use, so a rewritten
 * `.js` importer under `allowJs` is evicted along with the `.ts` ones.
 */
function evictParseIfSource(path: string): void {
  if (TS_EXTENSIONS.has(nodePath.extname(path))) evictDiagnosticParse(path);
}

const daemonState = createSelfWriteState(new NodeFileSystem(), evictParseIfSource);

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
