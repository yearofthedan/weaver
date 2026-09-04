import { Project } from "ts-morph";
import type ts from "typescript";
import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { describeCheckedScope, typeCheckedFiles } from "./type-check-scope.js";

function programFromFiles(files: Record<string, string>): ts.Program {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [filePath, content] of Object.entries(files)) {
    project.createSourceFile(filePath, content);
  }
  // Only a syntax-only service returns undefined here, and ts-morph never builds one.
  return project.getLanguageService().compilerObject.getProgram() as ts.Program;
}

describe("typeCheckedFiles", () => {
  describe("closing over imports", () => {
    it("closes a diamond import graph, returning the shared file once", () => {
      const program = programFromFiles({
        "/root.ts": 'import "./b";\nimport "./c";\n',
        "/b.ts": 'import "./d";\n',
        "/c.ts": 'import "./d";\n',
        "/d.ts": "export const d = 1;\n",
      });

      const result = typeCheckedFiles(["/root.ts"], [], program);

      expect(result).toEqual(new Set(["/root.ts", "/b.ts", "/c.ts", "/d.ts"]));
    });

    it("terminates and closes both files when two files import each other", () => {
      const program = programFromFiles({
        "/a.ts": 'import "./b";\n',
        "/b.ts": 'import "./a";\n',
      });

      const result = typeCheckedFiles(["/a.ts"], [], program);

      expect(result).toEqual(new Set(["/a.ts", "/b.ts"]));
    });

    it("skips resolving a seed path the program does not contain, without throwing", () => {
      const program = programFromFiles({
        "/a.ts": "export const a = 1;\n",
      });

      const result = typeCheckedFiles(["/a.ts", "/missing.ts"], [], program);

      expect(result).toEqual(new Set(["/a.ts", "/missing.ts"]));
    });

    it("continues traversal past an import that fails to resolve", () => {
      const program = programFromFiles({
        "/a.ts": 'import "./does-not-exist.js";\nimport "./b";\n',
        "/b.ts": "export const b = 1;\n",
      });

      const result = typeCheckedFiles(["/a.ts"], [], program);

      expect(result).toEqual(new Set(["/a.ts", "/b.ts"]));
    });
  });

  describe("no tsconfig", () => {
    it("returns the walked files unchanged when there is no seed", () => {
      const program = programFromFiles({ "/a.ts": "export const a = 1;\n" });

      const result = typeCheckedFiles(null, ["/a.ts", "/b.ts"], program);

      expect(result).toEqual(new Set(["/a.ts", "/b.ts"]));
    });
  });
});

describe("describeCheckedScope", () => {
  describe("workspace-file classification", () => {
    it("excludes the workspace root path itself from the checked count", () => {
      const scope = describeCheckedScope(
        new Set(["/workspace", "/workspace/src/a.ts"]),
        [],
        null,
        "/workspace",
        new InMemoryFileSystem(),
      );

      expect(scope.checked.files).toBe(1);
    });

    it("excludes a file above the workspace root from the checked count", () => {
      const scope = describeCheckedScope(
        new Set(["/above.ts", "/workspace/nested/src/a.ts"]),
        [],
        null,
        "/workspace/nested",
        new InMemoryFileSystem(),
      );

      expect(scope.checked.files).toBe(1);
    });

    it("excludes a file inside node_modules from the checked count", () => {
      const scope = describeCheckedScope(
        new Set(["/workspace/node_modules/dep/index.ts", "/workspace/src/a.ts"]),
        [],
        null,
        "/workspace",
        new InMemoryFileSystem(),
      );

      expect(scope.checked.files).toBe(1);
    });
  });

  describe("other configs at the workspace root", () => {
    it("excludes a directory whose name matches the config pattern", () => {
      const fs = new InMemoryFileSystem();
      fs.mkdir("/workspace", { recursive: true });
      fs.mkdir("/workspace/tsconfig.build.json", { recursive: true });
      fs.writeFile("/workspace/tsconfig.other.json", "{}");

      const scope = describeCheckedScope(
        new Set(),
        [],
        "/workspace/tsconfig.json",
        "/workspace",
        fs,
      );

      expect(scope.unchecked.otherConfigs).toEqual(["/workspace/tsconfig.other.json"]);
    });

    it("excludes a config-like file whose name does not start with tsconfig", () => {
      const fs = new InMemoryFileSystem();
      fs.mkdir("/workspace", { recursive: true });
      fs.writeFile("/workspace/mytsconfig.json", "{}");
      fs.writeFile("/workspace/tsconfig.other.json", "{}");

      const scope = describeCheckedScope(
        new Set(),
        [],
        "/workspace/tsconfig.json",
        "/workspace",
        fs,
      );

      expect(scope.unchecked.otherConfigs).toEqual(["/workspace/tsconfig.other.json"]);
    });

    it("excludes a config-like file with a non-json extension", () => {
      const fs = new InMemoryFileSystem();
      fs.mkdir("/workspace", { recursive: true });
      fs.writeFile("/workspace/tsconfig.jsonc", "{}");
      fs.writeFile("/workspace/tsconfig.other.json", "{}");

      const scope = describeCheckedScope(
        new Set(),
        [],
        "/workspace/tsconfig.json",
        "/workspace",
        fs,
      );

      expect(scope.unchecked.otherConfigs).toEqual(["/workspace/tsconfig.other.json"]);
    });

    it("returns at most the configured cap, sorted from all sibling configs", () => {
      const fs = new InMemoryFileSystem();
      fs.mkdir("/workspace", { recursive: true });
      const letters = ["l", "k", "j", "i", "h", "g", "f", "e", "d", "c", "b", "a"];
      for (const letter of letters) {
        fs.writeFile(`/workspace/tsconfig.${letter}.json`, "{}");
      }

      const scope = describeCheckedScope(
        new Set(),
        [],
        "/workspace/tsconfig.json",
        "/workspace",
        fs,
      );

      expect(scope.unchecked.otherConfigs).toEqual([
        "/workspace/tsconfig.a.json",
        "/workspace/tsconfig.b.json",
        "/workspace/tsconfig.c.json",
        "/workspace/tsconfig.d.json",
        "/workspace/tsconfig.e.json",
        "/workspace/tsconfig.f.json",
        "/workspace/tsconfig.g.json",
        "/workspace/tsconfig.h.json",
        "/workspace/tsconfig.i.json",
        "/workspace/tsconfig.j.json",
      ]);
    });
  });
});
