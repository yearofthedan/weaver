import type { FileSystem } from "../ports/filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";

const defaultFs: FileSystem = new NodeFileSystem();

/**
 * The one `FileSystem` every dispatcher operation writes through. Sharing a
 * single instance — rather than each call site constructing its own — is
 * what lets a write in one operation be observed by whatever wraps this
 * instance later (the self-write ledger, once it's wired in).
 */
export function getSharedFileSystem(): FileSystem {
  return defaultFs;
}
