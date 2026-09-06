import type { DirEntry, FileSystem } from "../filesystem.js";

/**
 * Wraps a `FileSystem`, recording every path passed to `readFile` so a test
 * can assert how many files were actually re-read through the port — the
 * question a cache-retention claim needs answered, since a passing type
 * check says nothing about whether it came from disk or from a cache.
 */
export class CountingFileSystem implements FileSystem {
  private reads: string[] = [];

  constructor(private readonly delegate: FileSystem) {}

  /** Paths passed to `readFile` since construction (or the last `resetReads`), in call order. */
  get readPaths(): readonly string[] {
    return this.reads;
  }

  /** Clears the recorded reads, so a later assertion only counts reads from this point on. */
  resetReads(): void {
    this.reads = [];
  }

  readFile(path: string): string {
    this.reads.push(path);
    return this.delegate.readFile(path);
  }

  writeFile(path: string, content: string): void {
    this.delegate.writeFile(path, content);
  }

  exists(path: string): boolean {
    return this.delegate.exists(path);
  }

  mkdir(path: string, options?: { recursive?: boolean }): void {
    this.delegate.mkdir(path, options);
  }

  rename(oldPath: string, newPath: string): void {
    this.delegate.rename(oldPath, newPath);
  }

  unlink(path: string): void {
    this.delegate.unlink(path);
  }

  realpath(path: string): string {
    return this.delegate.realpath(path);
  }

  resolve(...segments: string[]): string {
    return this.delegate.resolve(...segments);
  }

  stat(path: string): { isDirectory(): boolean; mtimeMs: number } {
    return this.delegate.stat(path);
  }

  readdir(path: string): DirEntry[] {
    return this.delegate.readdir(path);
  }
}
