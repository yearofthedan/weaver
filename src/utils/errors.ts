export type ErrorCode =
  | "FILE_NOT_FOUND"
  | "SYMBOL_NOT_FOUND"
  | "SYMBOL_EXISTS"
  | "RENAME_NOT_ALLOWED"
  | "NOT_SUPPORTED"
  | "WORKSPACE_VIOLATION"
  | "SENSITIVE_FILE"
  | "TEXT_MISMATCH"
  | "UNKNOWN_METHOD"
  | "PARSE_ERROR"
  | "VALIDATION_ERROR"
  | "REDOS"
  | "INVALID_PATH"
  | "NOT_A_DIRECTORY"
  | "DESTINATION_EXISTS"
  | "MOVE_INTO_SELF";

export class EngineError extends Error {
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }

  static is(e: unknown, code?: ErrorCode): e is EngineError {
    return e instanceof EngineError && (code === undefined || e.code === code);
  }
}
