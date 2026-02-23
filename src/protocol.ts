/**
 * Wire protocol types for daemon ↔ serve communication.
 * Ensures type safety across the socket boundary.
 */

// Request types
export interface RenameRequest {
  method: "rename";
  params: {
    file: string;
    line: number;
    col: number;
    newName: string;
    workspace: string;
  };
}

export interface MoveFileRequest {
  method: "moveFile";
  params: {
    oldPath: string;
    newPath: string;
    workspace: string;
  };
}

export interface MoveSymbolRequest {
  method: "moveSymbol";
  params: {
    sourceFile: string;
    symbolName: string;
    destFile: string;
    workspace: string;
  };
}

export interface FindReferencesRequest {
  method: "findReferences";
  params: {
    file: string;
    line: number;
    col: number;
  };
}

export interface GetDefinitionRequest {
  method: "getDefinition";
  params: {
    file: string;
    line: number;
    col: number;
  };
}

export type ProtocolRequest =
  | RenameRequest
  | MoveFileRequest
  | MoveSymbolRequest
  | FindReferencesRequest
  | GetDefinitionRequest;

// Response types
export interface RenameResponse {
  ok: true;
  filesModified: string[];
  filesSkipped: string[];
  symbolName: string;
  newName: string;
  locationCount: number;
}

export interface MoveFileResponse {
  ok: true;
  filesModified: string[];
  filesSkipped: string[];
  oldPath: string;
  newPath: string;
}

export interface MoveSymbolResponse {
  ok: true;
  filesModified: string[];
  filesSkipped: string[];
  symbolName: string;
  sourceFile: string;
  destFile: string;
}

export interface FindReferencesResponse {
  ok: true;
  symbolName: string;
  references: Array<{
    file: string;
    line: number;
    col: number;
    length: number;
  }>;
}

export interface GetDefinitionResponse {
  ok: true;
  symbolName: string;
  definitions: Array<{
    file: string;
    line: number;
    col: number;
    length: number;
  }>;
}

export interface ErrorResponse {
  ok: false;
  error: string;
  message?: string;
}

export type ProtocolResponse =
  | RenameResponse
  | MoveFileResponse
  | MoveSymbolResponse
  | FindReferencesResponse
  | GetDefinitionResponse
  | ErrorResponse;
