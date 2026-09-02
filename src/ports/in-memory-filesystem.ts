import * as nodePath from "node:path";
import type { DirEntry, FileSystem } from "./filesystem.js";

/**
 * In-memory file-system backed by a `Map<string, string>`.
 *
 * Designed for unit tests. Every operation is synchronous and never touches
 * the real disk. Directory markers are stored as keys ending with `/`.
 * `realpath` returns the input unchanged — there are no symlinks in memory.
 * `resolve` uses `node:path` so that `.` and `..` segments are normalised
 * correctly without any real I/O.
 */
export class InMemoryFileSystem implements FileSystem {
  private readonly store = new Map<string, string>();
  private readonly mtimes = new Map<string, number>();
  private mtimeCounter = 0;

  readFile(path: string): string {
    if (!this.store.has(path)) {
      throw new Error(`ENOENT: no such file or directory: '${path}'`);
    }
    return this.store.get(path) as string;
  }

  writeFile(path: string, content: string): void {
    this.store.set(path, content);
    this.touch(path);
  }

  exists(path: string): boolean {
    if (this.store.has(path)) return true;
    const prefix = path.endsWith("/") ? path : `${path}/`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  mkdir(path: string, _options?: { recursive?: boolean }): void {
    const marker = path.endsWith("/") ? path : `${path}/`;
    this.store.set(marker, "");
    this.touch(marker);
  }

  rename(oldPath: string, newPath: string): void {
    if (this.store.has(oldPath)) {
      const content = this.store.get(oldPath) as string;
      this.store.delete(oldPath);
      this.mtimes.delete(oldPath);
      this.store.set(newPath, content);
      this.touch(newPath);
      return;
    }
    if (this.isDirectory(oldPath)) {
      this.renameDirectory(oldPath, newPath);
      return;
    }
    throw new Error(`ENOENT: no such file or directory: '${oldPath}'`);
  }

  /**
   * `node:fs.renameSync` relocates a whole subtree, and operations that move a
   * directory depend on that. Keys are flat here, so the subtree has to be
   * rewritten prefix by prefix — the directory marker included, since a
   * directory that was only ever inferred from a child's path has none.
   */
  private renameDirectory(oldPath: string, newPath: string): void {
    const oldPrefix = oldPath.endsWith("/") ? oldPath : `${oldPath}/`;
    const newPrefix = newPath.endsWith("/") ? newPath : `${newPath}/`;

    for (const key of [...this.store.keys()]) {
      if (!key.startsWith(oldPrefix)) continue;
      const moved = newPrefix + key.slice(oldPrefix.length);
      this.store.set(moved, this.store.get(key) as string);
      this.store.delete(key);
      this.mtimes.delete(key);
      this.touch(moved);
    }
    this.store.set(newPrefix, "");
    this.touch(newPrefix);
  }

  unlink(path: string): void {
    if (!this.store.has(path)) {
      throw new Error(`ENOENT: no such file or directory: '${path}'`);
    }
    this.store.delete(path);
    this.mtimes.delete(path);
  }

  realpath(path: string): string {
    return path;
  }

  resolve(...segments: string[]): string {
    return nodePath.resolve(...segments);
  }

  stat(path: string): { isDirectory(): boolean; mtimeMs: number } {
    const isDir = this.isDirectory(path);
    const marker = path.endsWith("/") ? path : `${path}/`;
    const mtimeMs = this.mtimes.get(path) ?? this.mtimes.get(marker) ?? 0;
    return { isDirectory: () => isDir, mtimeMs };
  }

  /**
   * Bumps the path's stamp using a monotonic counter rather than a real
   * clock — every mutation is a distinct tick, so callers only ever need to
   * compare stamps for ordering, never their magnitude.
   */
  private touch(path: string): void {
    this.mtimeCounter += 1;
    this.mtimes.set(path, this.mtimeCounter);
  }

  readdir(path: string): DirEntry[] {
    if (!this.isDirectory(path)) {
      throw new Error(`ENOTDIR: not a directory: '${path}'`);
    }
    const prefix = path.endsWith("/") ? path : `${path}/`;
    // A child is a directory if any key nests below it (has a further slash),
    // otherwise a plain file. Collecting into sets keeps this order-independent
    // and lets directory classification win when a name appears as both.
    const dirs = new Set<string>();
    const files = new Set<string>();
    for (const key of this.store.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest === "") continue; // the directory's own marker key
      const slash = rest.indexOf("/");
      if (slash === -1) files.add(rest);
      else dirs.add(rest.slice(0, slash));
    }
    return [...new Set([...dirs, ...files])].map((name) => {
      const isDir = dirs.has(name);
      return { name, isDirectory: () => isDir, isFile: () => !isDir };
    });
  }

  private isDirectory(path: string): boolean {
    if (path.endsWith("/")) return true;
    const prefix = `${path}/`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }
}
