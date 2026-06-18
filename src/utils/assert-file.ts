import { EngineError } from "../domain/errors.js";
import type { FileSystem } from "../ports/filesystem.js";

/**
 * Resolve `filePath` to an absolute path and assert it exists.
 * Throws FILE_NOT_FOUND if the file is missing.
 * Returns the resolved absolute path.
 *
 * Existence is checked through the `FileSystem` port so callers can run against
 * an in-memory filesystem without writing to disk.
 */
export function assertFileExists(filePath: string, fs: FileSystem): string {
  const abs = fs.resolve(filePath);
  if (!fs.exists(abs)) {
    throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
  }
  return abs;
}
