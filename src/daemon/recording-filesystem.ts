import * as nodePath from "node:path";
import type { DirEntry, FileSystem } from "../ports/filesystem.js";
import { walkRecursive } from "../utils/file-walk.js";
import type { SelfWriteLedger } from "./self-write-ledger.js";

/**
 * Decorates a `FileSystem` so every mutation the daemon performs is reported
 * to a `SelfWriteLedger` and to `onMutated`, keeping the port itself free of
 * daemon-specific policy. Every mutating verb reports; a new one added to
 * `FileSystem` fails to compile here rather than silently going unobserved.
 */
export class RecordingFileSystem implements FileSystem {
  constructor(
    private readonly inner: FileSystem,
    private readonly ledger: SelfWriteLedger,
    private readonly onMutated: (path: string) => void = () => {},
  ) {}

  readFile(path: string): string {
    return this.inner.readFile(path);
  }

  writeFile(path: string, content: string): void {
    this.inner.writeFile(path, content);
    this.ledger.recordWrite(path);
    this.onMutated(path);
  }

  exists(path: string): boolean {
    return this.inner.exists(path);
  }

  mkdir(path: string, options?: { recursive?: boolean }): void {
    this.inner.mkdir(path, options);
    this.ledger.recordWrite(path);
  }

  rename(oldPath: string, newPath: string): void {
    this.inner.rename(oldPath, newPath);
    if (this.inner.stat(newPath).isDirectory()) {
      this.recordDirectoryRename(oldPath, newPath);
    } else {
      this.ledger.recordRemoval(oldPath);
      this.ledger.recordWrite(newPath);
      this.onMutated(oldPath);
      this.onMutated(newPath);
    }
  }

  unlink(path: string): void {
    this.inner.unlink(path);
    this.ledger.recordRemoval(path);
    this.onMutated(path);
  }

  realpath(path: string): string {
    return this.inner.realpath(path);
  }

  resolve(...segments: string[]): string {
    return this.inner.resolve(...segments);
  }

  stat(path: string): { isDirectory(): boolean; mtimeMs: number } {
    return this.inner.stat(path);
  }

  readdir(path: string): DirEntry[] {
    return this.inner.readdir(path);
  }

  /**
   * The watcher never reports a directory rename as such — it reports one
   * `unlink` per file at the old location and one `add` per file at the new
   * one. Recording only the two directory paths would leave that whole
   * event burst unsuppressed, so each file in the moved subtree is recorded
   * individually: the old path derived by re-parenting the new path's
   * relative position under `oldPath`.
   */
  private recordDirectoryRename(oldPath: string, newPath: string): void {
    for (const newFile of walkRecursive(newPath, this.inner)) {
      const relative = nodePath.relative(newPath, newFile);
      const oldFile = nodePath.join(oldPath, relative);
      this.ledger.recordRemoval(oldFile);
      this.ledger.recordWrite(newFile);
      this.onMutated(oldFile);
      this.onMutated(newFile);
    }
  }
}
