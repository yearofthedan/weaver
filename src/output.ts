export interface SuccessOutput {
  ok: true;
  filesModified: string[];
  summary: string;
}

export interface ErrorOutput {
  ok: false;
  error: ErrorCode;
  message: string;
}

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "FILE_NOT_FOUND"
  | "SYMBOL_NOT_FOUND"
  | "RENAME_NOT_ALLOWED"
  | "TSCONFIG_NOT_FOUND"
  | "ENGINE_ERROR";

export type Output = SuccessOutput | ErrorOutput;

export function outputSuccess(filesModified: string[], summary: string): never {
  const result: SuccessOutput = { ok: true, filesModified, summary };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}

export function outputError(error: ErrorCode, message: string): never {
  const result: ErrorOutput = { ok: false, error, message };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(1);
}
