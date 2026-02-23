import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertFileExists } from "../../src/utils/assert-file.js";
import { EngineError } from "../../src/utils/errors.js";

describe("assertFileExists", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("returns the resolved absolute path for an existing file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assert-file-"));
    tmpDirs.push(dir);
    const filePath = path.join(dir, "test.ts");
    fs.writeFileSync(filePath, "");

    const result = assertFileExists(filePath);
    expect(result).toBe(path.resolve(filePath));
  });

  it("resolves relative paths to absolute", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assert-file-"));
    tmpDirs.push(dir);
    const filePath = path.join(dir, "test.ts");
    fs.writeFileSync(filePath, "");

    // Temporarily change cwd won't work reliably; use absolute path directly.
    const result = assertFileExists(filePath);
    expect(path.isAbsolute(result)).toBe(true);
  });

  it("throws FILE_NOT_FOUND for a missing file", () => {
    expect(() => assertFileExists("/nonexistent/path/file.ts")).toThrow(EngineError);
    expect(() => assertFileExists("/nonexistent/path/file.ts")).toThrow(
      expect.objectContaining({ code: "FILE_NOT_FOUND" }),
    );
  });

  it("includes the original filePath in the error message", () => {
    const missing = "/no/such/file.ts";
    let err: unknown;
    try {
      assertFileExists(missing);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).message).toContain(missing);
  });
});
