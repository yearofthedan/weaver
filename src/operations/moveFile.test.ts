import { describe, expect, it, vi } from "vitest";
import { makeMockCompiler } from "../compilers/__helpers__/mock-compiler.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { moveFile } from "./moveFile.js";

// assertFileExists (called inside moveFile) still uses the real filesystem — it is not yet
// migrated to the FileSystem port. In unit tests that mock the compiler, we pass a path
// that is guaranteed to exist on disk so that guard passes without creating extra files.
const EXISTING_FILE = new URL(import.meta.url).pathname;

// URL.pathname for a directory URL ends with "/". Strip it so that paths built as
// `${workspace}/some-file.ts` do not contain double slashes.
function workspaceFromUrl(steps: string): string {
  return new URL(steps, import.meta.url).pathname.replace(/\/$/, "");
}

describe("moveFile action", () => {
  describe("workspace boundary and scope tracking", () => {
    it("delegates to engine.moveFile with resolved paths", async () => {
      const workspace = workspaceFromUrl("../..");
      const newFilePath = `${workspace}/moved-file.ts`;

      const moveFileFn = vi.fn().mockImplementation((_old, _new, scope) => {
        scope.recordModified(_new);
        return Promise.resolve({ oldPath: EXISTING_FILE, newPath: newFilePath });
      });
      const compiler = makeMockCompiler({ moveFile: moveFileFn });

      const memFs = new InMemoryFileSystem();
      memFs.writeFile(EXISTING_FILE, "// source content");
      const scope = new WorkspaceScope(workspace, memFs);

      const result = await moveFile(compiler, EXISTING_FILE, newFilePath, scope);

      expect(moveFileFn).toHaveBeenCalledWith(EXISTING_FILE, newFilePath, scope);
      expect(result.oldPath).toBe(EXISTING_FILE);
      expect(result.newPath).toBe(newFilePath);
    });

    it("records modified files from scope into result", async () => {
      const workspace = workspaceFromUrl("../..");
      const inFile = `${workspace}/some-file.ts`;
      const newFilePath = `${workspace}/some-file-new.ts`;

      const compiler = makeMockCompiler({
        moveFile: vi.fn().mockImplementation((_old, _new, scope) => {
          scope.recordModified(inFile);
          scope.recordModified(_new);
          return Promise.resolve({ oldPath: _old, newPath: _new });
        }),
      });

      const memFs = new InMemoryFileSystem();
      memFs.writeFile(EXISTING_FILE, "// source content");
      const scope = new WorkspaceScope(workspace, memFs);

      const result = await moveFile(compiler, EXISTING_FILE, newFilePath, scope);

      expect(result.filesModified).toContain(inFile);
      expect(result.filesModified).toContain(newFilePath);
    });

    it("records skipped files from scope into result", async () => {
      const workspace = workspaceFromUrl("../..");
      const outFile = "/outside/consumer.ts";

      const compiler = makeMockCompiler({
        moveFile: vi.fn().mockImplementation((_old, _new, scope) => {
          scope.recordSkipped(outFile);
          return Promise.resolve({ oldPath: _old, newPath: _new });
        }),
      });

      const memFs = new InMemoryFileSystem();
      memFs.writeFile(EXISTING_FILE, "// source content");
      const scope = new WorkspaceScope(workspace, memFs);

      const result = await moveFile(compiler, EXISTING_FILE, `${EXISTING_FILE}.moved`, scope);

      expect(result.filesSkipped).toContain(outFile);
      expect(result.filesModified).not.toContain(outFile);
    });

    it("throws FILE_NOT_FOUND when source file does not exist", async () => {
      const workspace = workspaceFromUrl("../..");
      const compiler = makeMockCompiler();
      const memFs = new InMemoryFileSystem();
      const scope = new WorkspaceScope(workspace, memFs);

      await expect(
        moveFile(compiler, `${workspace}/does-not-exist.ts`, `${workspace}/out.ts`, scope),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });
  });
});
