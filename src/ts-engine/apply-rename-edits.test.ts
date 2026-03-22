import { describe, expect, it, vi } from "vitest";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import { applyRenameEdits, mergeFileEdits } from "./apply-rename-edits.js";
import type { Engine, FileTextEdit } from "./types.js";

function makeCompiler(fileContents: Record<string, string>): Pick<Engine, "readFile"> {
  return {
    readFile: (path: string) => fileContents[path] ?? "",
  };
}

function makeScope(inside: string[]) {
  const written = new Map<string, string>();
  const skipped: string[] = [];
  const modified: string[] = [];
  return {
    contains: (p: string) => inside.includes(p),
    recordSkipped: (p: string) => skipped.push(p),
    writeFile: (p: string, content: string) => {
      written.set(p, content);
      modified.push(p);
    },
    recordModified: vi.fn(),
    _written: written,
    _skipped: skipped,
    _modified: modified,
  };
}

describe("mergeFileEdits", () => {
  describe("disjoint target files", () => {
    it("produces one entry per distinct target file", () => {
      const editSet1: FileTextEdit[] = [
        {
          fileName: "/src/a.ts",
          textChanges: [{ span: { start: 10, length: 5 }, newText: "newA" }],
        },
      ];
      const editSet2: FileTextEdit[] = [
        {
          fileName: "/src/b.ts",
          textChanges: [{ span: { start: 20, length: 3 }, newText: "newB" }],
        },
      ];

      const result = mergeFileEdits([editSet1, editSet2]);

      expect(result).toHaveLength(2);
      const fileA = result.find((e) => e.fileName === "/src/a.ts");
      const fileB = result.find((e) => e.fileName === "/src/b.ts");
      expect(fileA?.textChanges).toEqual([{ span: { start: 10, length: 5 }, newText: "newA" }]);
      expect(fileB?.textChanges).toEqual([{ span: { start: 20, length: 3 }, newText: "newB" }]);
    });
  });

  describe("same target file in multiple edit sets", () => {
    it("merges textChanges arrays for the same target file", () => {
      const editSet1: FileTextEdit[] = [
        {
          fileName: "/src/importer.ts",
          textChanges: [{ span: { start: 5, length: 10 }, newText: "first" }],
        },
      ];
      const editSet2: FileTextEdit[] = [
        {
          fileName: "/src/importer.ts",
          textChanges: [{ span: { start: 50, length: 8 }, newText: "second" }],
        },
      ];

      const result = mergeFileEdits([editSet1, editSet2]);

      expect(result).toHaveLength(1);
      expect(result[0].fileName).toBe("/src/importer.ts");
      expect(result[0].textChanges).toHaveLength(2);
      expect(result[0].textChanges).toContainEqual({
        span: { start: 5, length: 10 },
        newText: "first",
      });
      expect(result[0].textChanges).toContainEqual({
        span: { start: 50, length: 8 },
        newText: "second",
      });
    });

    it("removes duplicate spans when multiple edit sets produce the same change", () => {
      const duplicateChange = { span: { start: 5, length: 10 }, newText: "same" };
      const editSet1: FileTextEdit[] = [
        { fileName: "/src/importer.ts", textChanges: [duplicateChange] },
      ];
      const editSet2: FileTextEdit[] = [
        { fileName: "/src/importer.ts", textChanges: [duplicateChange] },
      ];

      const result = mergeFileEdits([editSet1, editSet2]);

      expect(result).toHaveLength(1);
      expect(result[0].textChanges).toHaveLength(1);
      expect(result[0].textChanges[0]).toEqual(duplicateChange);
    });

    it("keeps distinct changes that differ only in newText at the same span", () => {
      const editSet1: FileTextEdit[] = [
        {
          fileName: "/src/importer.ts",
          textChanges: [{ span: { start: 5, length: 10 }, newText: "a" }],
        },
      ];
      const editSet2: FileTextEdit[] = [
        {
          fileName: "/src/importer.ts",
          textChanges: [{ span: { start: 5, length: 10 }, newText: "b" }],
        },
      ];

      const result = mergeFileEdits([editSet1, editSet2]);

      expect(result[0].textChanges).toHaveLength(2);
    });
  });

  describe("empty input", () => {
    it("returns empty array for empty array input", () => {
      expect(mergeFileEdits([])).toEqual([]);
    });

    it("returns empty array when all edit sets are empty", () => {
      expect(mergeFileEdits([[], []])).toEqual([]);
    });
  });
});

describe("applyRenameEdits", () => {
  describe("files within scope", () => {
    it("applies text edits to files inside the workspace", () => {
      const edits: FileTextEdit[] = [
        {
          fileName: "/workspace/src/importer.ts",
          textChanges: [{ span: { start: 22, length: 9 }, newText: "./lib/a" }],
        },
      ];
      const originalContent = 'import { a } from "./utils/a";\n';
      const compiler = makeCompiler({ "/workspace/src/importer.ts": originalContent });
      const scope = makeScope(["/workspace/src/importer.ts"]);

      applyRenameEdits(compiler as unknown as Engine, edits, scope as unknown as WorkspaceScope);

      expect(scope._written.has("/workspace/src/importer.ts")).toBe(true);
      expect(scope._written.get("/workspace/src/importer.ts")).toContain("./lib/a");
    });
  });

  describe("files outside workspace scope", () => {
    it("records files outside scope as skipped without writing them", () => {
      const edits: FileTextEdit[] = [
        {
          fileName: "/outside/other.ts",
          textChanges: [{ span: { start: 10, length: 5 }, newText: "new" }],
        },
      ];
      const compiler = makeCompiler({ "/outside/other.ts": "some content" });
      const scope = makeScope([]);

      applyRenameEdits(compiler as unknown as Engine, edits, scope as unknown as WorkspaceScope);

      expect(scope._skipped).toContain("/outside/other.ts");
      expect(scope._written.has("/outside/other.ts")).toBe(false);
    });

    it("processes in-scope files even when mixed with out-of-scope files", () => {
      const edits: FileTextEdit[] = [
        {
          fileName: "/outside/other.ts",
          textChanges: [{ span: { start: 5, length: 3 }, newText: "x" }],
        },
        {
          fileName: "/workspace/src/importer.ts",
          textChanges: [{ span: { start: 0, length: 6 }, newText: "import" }],
        },
      ];
      const compiler = makeCompiler({
        "/outside/other.ts": "outside",
        "/workspace/src/importer.ts": "import",
      });
      const scope = makeScope(["/workspace/src/importer.ts"]);

      applyRenameEdits(compiler as unknown as Engine, edits, scope as unknown as WorkspaceScope);

      expect(scope._written.has("/workspace/src/importer.ts")).toBe(true);
      expect(scope._skipped).toContain("/outside/other.ts");
      expect(scope._written.has("/outside/other.ts")).toBe(false);
    });
  });
});
