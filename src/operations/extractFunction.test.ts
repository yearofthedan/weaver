import { describe, expect, it, vi } from "vitest";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import type { Engine } from "../ts-engine/types.js";
import { extractFunction } from "./extractFunction.js";

function scopeWith(files: Record<string, string> = {}): WorkspaceScope {
  const vfs = new InMemoryFileSystem();
  for (const [path, content] of Object.entries(files)) {
    vfs.writeFile(path, content);
  }
  return new WorkspaceScope("/ws", vfs);
}

describe("extractFunction operation", () => {
  it("throws FILE_NOT_FOUND for a missing source file", async () => {
    const fakeEngine = {} as Engine;

    await expect(
      extractFunction(fakeEngine, "/ws/src/does-not-exist.ts", 1, 1, 1, 10, "myFn", scopeWith()),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  it("delegates to engine.extractFunction with correct arguments and returns its result", async () => {
    const filePath = "/ws/src/target.ts";
    const scope = scopeWith({ [filePath]: "export function foo() {}\n" });

    const expectedResult = {
      filesModified: [filePath],
      filesSkipped: [],
      functionName: "extracted",
      parameterCount: 1,
    };
    const mockEngine = {
      extractFunction: vi.fn().mockResolvedValue(expectedResult),
    } as unknown as Engine;

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
