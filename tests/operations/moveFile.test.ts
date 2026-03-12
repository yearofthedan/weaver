import { describe, expect, it, vi } from "vitest";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { moveFile } from "../../src/operations/moveFile.js";
import { InMemoryFileSystem } from "../../src/ports/in-memory-filesystem.js";
import { makeMockCompiler } from "../compilers/__helpers__/mock-compiler.js";

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
    it("skips files outside workspace and records them in filesSkipped", async () => {
      const workspace = workspaceFromUrl("../..");
      const outFile = "/outside/consumer.ts";

      const compiler = makeMockCompiler({
        getEditsForFileRename: vi.fn().mockResolvedValue([
          {
            fileName: outFile,
            textChanges: [],
          },
        ]),
      });

      const memFs = new InMemoryFileSystem();
      memFs.writeFile(EXISTING_FILE, "// source content");
      const scope = new WorkspaceScope(workspace, memFs);

      const result = await moveFile(compiler, EXISTING_FILE, `${EXISTING_FILE}.moved`, scope);

      expect(result.filesSkipped).toContain(outFile);
      expect(result.filesModified).not.toContain(outFile);
    });

    it("records modified files in filesModified", async () => {
      const workspace = workspaceFromUrl("../..");
      const inFile = `${workspace}/some-file.ts`;
      const newFilePath = `${workspace}/some-file-new.ts`;

      const compiler = makeMockCompiler({
        getEditsForFileRename: vi.fn().mockResolvedValue([
          {
            fileName: inFile,
            textChanges: [{ span: { start: 0, length: 7 }, newText: "updated" }],
          },
        ]),
        readFile: vi.fn().mockReturnValue("content"),
      });

      const memFs = new InMemoryFileSystem();
      memFs.writeFile(EXISTING_FILE, "// source content");
      const scope = new WorkspaceScope(workspace, memFs);

      const result = await moveFile(compiler, EXISTING_FILE, newFilePath, scope);

      expect(result.filesModified).toContain(inFile);
      expect(result.filesModified).toContain(newFilePath);
    });

    it("writes updated file content through scope", async () => {
      const workspace = workspaceFromUrl("../..");
      const inFile = `${workspace}/some-file.ts`;
      const newFilePath = `${workspace}/some-file-new.ts`;
      const originalContent = 'import { foo } from "./old"';
      const updatedContent = 'import { foo } from "./new"';

      const compiler = makeMockCompiler({
        getEditsForFileRename: vi.fn().mockResolvedValue([
          {
            fileName: inFile,
            textChanges: [{ span: { start: 21, length: 5 }, newText: "./new" }],
          },
        ]),
        readFile: vi.fn().mockReturnValue(originalContent),
      });

      const memFs = new InMemoryFileSystem();
      memFs.writeFile(EXISTING_FILE, "// source content");
      const scope = new WorkspaceScope(workspace, memFs);

      await moveFile(compiler, EXISTING_FILE, newFilePath, scope);

      expect(memFs.readFile(inFile)).toBe(updatedContent);
    });

    it("creates destination directory when it does not exist", async () => {
      const workspace = workspaceFromUrl("../..");
      const newFilePath = `${workspace}/deep/nested/dir/some-file.ts`;

      const compiler = makeMockCompiler({
        getEditsForFileRename: vi.fn().mockResolvedValue([]),
      });

      const memFs = new InMemoryFileSystem();
      memFs.writeFile(EXISTING_FILE, "// source content");
      const scope = new WorkspaceScope(workspace, memFs);

      await moveFile(compiler, EXISTING_FILE, newFilePath, scope);

      // Destination directory marker should exist
      expect(memFs.exists(`${workspace}/deep/nested/dir`)).toBe(true);
    });

    it("moves the physical file (old path gone, new path exists)", async () => {
      const workspace = workspaceFromUrl("../..");
      const newFilePath = `${workspace}/moved-file.ts`;

      const compiler = makeMockCompiler({
        getEditsForFileRename: vi.fn().mockResolvedValue([]),
      });

      const memFs = new InMemoryFileSystem();
      memFs.writeFile(EXISTING_FILE, "// source content");
      const scope = new WorkspaceScope(workspace, memFs);

      await moveFile(compiler, EXISTING_FILE, newFilePath, scope);

      expect(memFs.exists(newFilePath)).toBe(true);
      expect(memFs.exists(EXISTING_FILE)).toBe(false);
    });

    it("merges afterFileRename results into scope tracking", async () => {
      const workspace = workspaceFromUrl("../..");
      const newFilePath = `${workspace}/moved-file.ts`;
      const extraModified = `${workspace}/extra-modified.ts`;
      const extraSkipped = "/outside/extra-skipped.ts";

      const compiler = makeMockCompiler({
        getEditsForFileRename: vi.fn().mockResolvedValue([]),
        afterFileRename: vi
          .fn()
          .mockResolvedValue({ modified: [extraModified], skipped: [extraSkipped] }),
      });

      const memFs = new InMemoryFileSystem();
      memFs.writeFile(EXISTING_FILE, "// source content");
      const scope = new WorkspaceScope(workspace, memFs);

      const result = await moveFile(compiler, EXISTING_FILE, newFilePath, scope);

      expect(result.filesModified).toContain(extraModified);
      expect(result.filesSkipped).toContain(extraSkipped);
    });
  });
});
