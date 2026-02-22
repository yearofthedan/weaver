export interface RenameResult {
  filesModified: string[];
  /** Impacted files outside workspace that were not written. */
  filesSkipped: string[];
  symbolName: string;
  newName: string;
  locationCount: number;
}

export interface MoveResult {
  filesModified: string[];
  /** Impacted files outside workspace that were not written. */
  filesSkipped: string[];
  oldPath: string;
  newPath: string;
}

export interface RefactorEngine {
  /**
   * Rename the symbol at (line, col) in filePath to newName.
   * line and col are 1-based.
   * workspace is the absolute workspace root; impacted files outside it are skipped.
   */
  rename(
    filePath: string,
    line: number,
    col: number,
    newName: string,
    workspace: string,
  ): Promise<RenameResult>;

  /**
   * Move a file from oldPath to newPath, updating all import references.
   * workspace is the absolute workspace root; impacted files outside it are skipped.
   */
  moveFile(oldPath: string, newPath: string, workspace: string): Promise<MoveResult>;
}
