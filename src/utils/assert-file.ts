import * as fs from "node:fs";
import * as path from "node:path";
import { EngineError } from "./errors.js";

/**
 * Resolve `filePath` to an absolute path and assert it exists.
 * Throws FILE_NOT_FOUND if the file is missing.
 * Returns the resolved absolute path.
 */
export function assertFileExists(filePath: string): string {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
  }
  return abs;
}
