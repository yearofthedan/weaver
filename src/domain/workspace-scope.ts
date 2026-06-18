import type { FileSystem } from "../ports/filesystem.js";
import { EngineError } from "./errors.js";
import { isWithinWorkspace } from "./security.js";

/**
 * Tracks workspace boundary membership and records which files were modified
 * or skipped during an operation.
 *
 * `contains()` resolves symlinks via `this.fs` before calling the pure
 * `isWithinWorkspace` — callers must not reimplement the boundary check.
 *
 * `writeFile()` enforces the boundary before writing: paths outside the workspace
 * throw `EngineError` with code `"WORKSPACE_VIOLATION"`.
 */
export class WorkspaceScope {
  readonly fs: FileSystem;
  readonly root: string;
  private readonly _modified = new Set<string>();
  private readonly _skipped = new Set<string>();

  constructor(root: string, fs: FileSystem) {
    this.root = root;
    this.fs = fs;
  }

  contains(filePath: string): boolean {
    if (!isWithinWorkspace(filePath, this.root)) return false;
    if (this.fs.exists(filePath)) {
      try {
        const realFile = this.fs.realpath(filePath);
        const realRoot = this.fs.realpath(this.root);
        return isWithinWorkspace(realFile, realRoot);
      } catch {
        return false;
      }
    }
    return true;
  }

  recordModified(filePath: string): void {
    this._modified.add(filePath);
  }

  recordSkipped(filePath: string): void {
    this._skipped.add(filePath);
  }

  writeFile(filePath: string, content: string): void {
    if (!this.contains(filePath)) {
      throw new EngineError(
        `Path is outside the workspace boundary: ${filePath}`,
        "WORKSPACE_VIOLATION",
      );
    }
    this.fs.writeFile(filePath, content);
    this.recordModified(filePath);
  }

  /** Returns a new array on every call — snapshot before looping if you check membership repeatedly. */
  get modified(): string[] {
    return [...this._modified];
  }

  get skipped(): string[] {
    return [...this._skipped];
  }
}
