/**
 * A directory entry, mirroring the subset of `node:fs.Dirent` the walkers need.
 * `isDirectory`/`isFile` classify the entry itself **without following
 * symlinks** — a symlink reports neither, so a walk skips it rather than
 * traversing (and potentially cycling) into its target.
 */
export interface DirEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

/**
 * Synchronous file-system abstraction. Matches the shape of `node:fs` sync
 * methods so that `NodeFileSystem` is a thin wrapper and `InMemoryFileSystem`
 * can substitute it in tests without touching the real disk.
 */
export interface FileSystem {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  exists(path: string): boolean;
  mkdir(path: string, options?: { recursive?: boolean }): void;
  rename(oldPath: string, newPath: string): void;
  unlink(path: string): void;
  realpath(path: string): string;
  resolve(...segments: string[]): string;
  stat(path: string): { isDirectory(): boolean };
  /** Immediate child entries (basenames + no-follow type). Throws on a missing path or a file. */
  readdir(path: string): DirEntry[];
}

export { InMemoryFileSystem } from "./in-memory-filesystem.js";
export { NodeFileSystem } from "./node-filesystem.js";
