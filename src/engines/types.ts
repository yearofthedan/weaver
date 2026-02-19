export interface RenameResult {
  filesModified: string[];
  symbolName: string;
  newName: string;
  locationCount: number;
}

export interface MoveResult {
  filesModified: string[];
  oldPath: string;
  newPath: string;
}

export interface RefactorEngine {
  /**
   * Rename the symbol at (line, col) in filePath to newName.
   * line and col are 1-based.
   */
  rename(filePath: string, line: number, col: number, newName: string): Promise<RenameResult>;

  /**
   * Move a file from oldPath to newPath, updating all import references.
   */
  moveFile(oldPath: string, newPath: string): Promise<MoveResult>;
}
