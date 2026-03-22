import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Engine } from "../ts-engine/types.js";
import { extractFunction } from "./extractFunction.js";

describe("extractFunction operation", () => {
  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-extractfn-op-"));
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    return dir;
  }

  it("throws FILE_NOT_FOUND for a missing source file", async () => {
    const dir = makeTempDir();
    const fakeEngine = {} as Engine;

    await expect(
      extractFunction(
        fakeEngine,
        path.join(dir, "src/does-not-exist.ts"),
        1,
        1,
        1,
        10,
        "myFn",
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        {} as any,
      ),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  it("delegates to engine.extractFunction with correct arguments and returns its result", async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, "src/target.ts");
    fs.writeFileSync(filePath, "export function foo() {}\n");

    const expectedResult = {
      filesModified: [filePath],
      filesSkipped: [],
      functionName: "extracted",
      parameterCount: 1,
    };

    const mockEngine = {
      extractFunction: vi.fn().mockResolvedValue(expectedResult),
    } as unknown as Engine;

    // biome-ignore lint/suspicious/noExplicitAny: test stub
    const scope = {} as any;

    const result = await extractFunction(mockEngine, filePath, 2, 3, 4, 19, "extracted", scope);

    expect(mockEngine.extractFunction).toHaveBeenCalledWith(
      filePath,
      2,
      3,
      4,
      19,
      "extracted",
      scope,
    );
    expect(result).toBe(expectedResult);
  });
});
