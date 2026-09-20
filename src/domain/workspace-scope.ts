import type { FileSystem } from "../ports/filesystem.js";
import { EngineError } from "./errors.js";
import { isWithinWorkspace } from "./security.js";

/**
 * Tracks workspace boundary membership and records which files were modified
 * or skipped during an operation.
 *
 * `contains()` judges an existing path by its real location, resolved through `this.fs`, and a
 * missing one lexically — callers must not reimplement the boundary check.
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
    if (!this.fs.exists(filePath)) return isWithinWorkspace(filePath, this.root);
    // An existing path is judged by where it really is. A caller can name a file inside the
    // workspace through a symlinked spelling of the root (`/tmp` for `/private/tmp`), which the
    // lexical comparison reads as outside; a symlink inside the workspace that points out of it
    // still resolves outside.
    try {
      return isWithinWorkspace(this.fs.realpath(filePath), this.fs.realpath(this.root));
    } catch {
      return false;
    }
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
