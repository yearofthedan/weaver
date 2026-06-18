import { describe, expect, it } from "vitest";
import { EngineError } from "../domain/errors.js";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { assertFileExists } from "./assert-file.js";

describe("assertFileExists", () => {
  it("returns the resolved absolute path for an existing file", () => {
    const fs = new InMemoryFileSystem();
    fs.writeFile("/project/src/test.ts", "");

    expect(assertFileExists("/project/src/test.ts", fs)).toBe("/project/src/test.ts");
  });

  it("resolves a relative path to absolute before checking existence", () => {
    const fs = new InMemoryFileSystem();
    const abs = fs.resolve("rel/test.ts");
    fs.writeFile(abs, "");

    // The file is only stored under its absolute path, so a correct
    // implementation must resolve before calling exists().
    expect(assertFileExists("rel/test.ts", fs)).toBe(abs);
  });

  it("throws FILE_NOT_FOUND for a missing file", () => {
    const fs = new InMemoryFileSystem();

    expect(() => assertFileExists("/nonexistent/path/file.ts", fs)).toThrow(EngineError);
    expect(() => assertFileExists("/nonexistent/path/file.ts", fs)).toThrow(
      expect.objectContaining({ code: "FILE_NOT_FOUND" }),
    );
  });

  it("includes the original filePath in the error message", () => {
    const fs = new InMemoryFileSystem();
    const missing = "/no/such/file.ts";
    let err: unknown;
    try {
      assertFileExists(missing, fs);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).message).toContain(missing);
  });
});
