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
}

export { InMemoryFileSystem } from "./in-memory-filesystem.js";
export { NodeFileSystem } from "./node-filesystem.js";
