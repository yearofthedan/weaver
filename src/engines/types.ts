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

export interface MoveSymbolResult {
  filesModified: string[];
  /** Impacted files outside workspace that were not written. */
  filesSkipped: string[];
  symbolName: string;
  sourceFile: string;
  destFile: string;
}

export interface Reference {
  file: string;
  line: number;
  col: number;
  length: number;
}

export interface FindReferencesResult {
  symbolName: string;
  references: Reference[];
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

  /**
   * Move a named export from sourceFile to destFile, updating all import references.
   * destFile is created if it does not exist.
   * workspace is the absolute workspace root; impacted files outside it are skipped.
   */
  moveSymbol(
    sourceFile: string,
    symbolName: string,
    destFile: string,
    workspace: string,
  ): Promise<MoveSymbolResult>;

  /**
   * Find all references to the symbol at (line, col) in filePath.
   * line and col are 1-based. Read-only — does not modify any files.
   */
  findReferences(filePath: string, line: number, col: number): Promise<FindReferencesResult>;
}
