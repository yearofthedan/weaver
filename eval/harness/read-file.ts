import * as fs from "node:fs";

/**
 * Reads a UTF-8 file at an absolute path. When the file is missing (ENOENT),
 * throws an Error carrying the caller's `notFoundMessage` — the friendly text
 * that names what was being looked for. Any other read failure is re-thrown
 * unchanged.
 */
export function readFileOrThrow(absPath: string, notFoundMessage: string): string {
  try {
    return fs.readFileSync(absPath, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error(notFoundMessage);
    }
    throw err;
  }
}
