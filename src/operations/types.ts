export interface NameMatchSample {
  file: string;
  line: number;
  col: number;
  name: string;
  kind: string;
}

export interface NameMatches {
  count: number;
  files: number;
  samples: NameMatchSample[];
}

export interface RenameResult {
  filesModified: string[];
  /** Impacted files outside workspace that were not written. */
  filesSkipped: string[];
  symbolName: string;
  newName: string;
  locationCount: number;
  /** Present on TS renames; absent on Vue renames. */
  nameMatches?: NameMatches;
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

export type { ExtractFunctionResult } from "../ts-engine/types.js";

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

export interface FindImportersResult {
  fileName: string;
  references: Reference[];
}

export interface Definition {
  file: string;
  line: number;
  col: number;
  length: number;
}

export interface GetDefinitionResult {
  symbolName: string;
  definitions: Definition[];
}

export interface SearchMatch {
  file: string;
  line: number;
  col: number;
  matchText: string;
  surroundingText?: string;
}

export interface SearchTextResult {
  matches: SearchMatch[];
  /** True if the result set was capped at the internal limit. */
  truncated: boolean;
}

export interface TextEdit {
  file: string;
  line: number;
  col: number;
  oldText: string;
  newText: string;
}

export interface ReplaceTextResult {
  filesModified: string[];
  replacementCount: number;
}

export interface MoveDirectoryResult {
  filesMoved: string[];
  filesModified: string[];
  /** Impacted files outside workspace that were not written. */
  filesSkipped: string[];
  oldPath: string;
  newPath: string;
}

export interface DeleteFileResult {
  deletedFile: string;
  filesModified: string[];
  /** Importers outside the workspace boundary — found but not written. */
  filesSkipped: string[];
  /** Total import/export declarations removed across all modified files. */
  importRefsRemoved: number;
}

export interface TypeDiagnostic {
  file: string;
  line: number;
  col: number;
  code: number;
  message: string;
}

export interface GetTypeErrorsResult {
  diagnostics: TypeDiagnostic[];
  /** Total number of errors found (may exceed diagnostics.length when truncated). */
  errorCount: number;
  /** True when the result was capped at the internal limit. */
  truncated: boolean;
}

export interface PostWriteDiagnostics {
  typeErrors: TypeDiagnostic[];
  /** True total error count across modified files (may exceed typeErrors.length). */
  typeErrorCount: number;
  /** True when results were capped at the internal limit. */
  typeErrorsTruncated: boolean;
}
