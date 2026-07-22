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

  readFile(path: string): string {
    if (!this.store.has(path)) {
      throw new Error(`ENOENT: no such file or directory: '${path}'`);
    }
    return this.store.get(path) as string;
  }

  writeFile(path: string, content: string): void {
    this.store.set(path, content);
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
  }

  rename(oldPath: string, newPath: string): void {
    if (!this.store.has(oldPath)) {
      throw new Error(`ENOENT: no such file or directory: '${oldPath}'`);
    }
    const content = this.store.get(oldPath) as string;
    this.store.delete(oldPath);
    this.store.set(newPath, content);
  }

  unlink(path: string): void {
    if (!this.store.has(path)) {
      throw new Error(`ENOENT: no such file or directory: '${path}'`);
    }
    this.store.delete(path);
  }

  realpath(path: string): string {
    return path;
  }

  resolve(...segments: string[]): string {
    return nodePath.resolve(...segments);
  }

  stat(path: string): { isDirectory(): boolean } {
    const isDir = this.isDirectory(path);
    return { isDirectory: () => isDir };
  }

  readdir(path: string): DirEntry[] {
    if (!this.isDirectory(path)) {
      throw new Error(`ENOTDIR: not a directory: '${path}'`);
    }
    const prefix = path.endsWith("/") ? path : `${path}/`;
    // name → isDirectory. A name is a directory if any key nests below it;
    // a plain key with no further slash is a file. Directory wins on conflict.
    const childIsDir = new Map<string, boolean>();
    for (const key of this.store.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest === "") continue; // the directory marker itself
      const slash = rest.indexOf("/");
      if (slash === -1) {
        if (!childIsDir.has(rest)) childIsDir.set(rest, false);
      } else {
        childIsDir.set(rest.slice(0, slash), true);
      }
    }
    return [...childIsDir].map(([name, isDir]) => ({
      name,
      isDirectory: () => isDir,
      isFile: () => !isDir,
    }));
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
