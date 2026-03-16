import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { rewriteMovedFileOwnImports } from "./rewrite-own-imports.js";
import { WorkspaceScope } from "./workspace-scope.js";

const ROOT = "/project";

function makeScope(files: Record<string, string> = {}): WorkspaceScope {
  const vfs = new InMemoryFileSystem();
  for (const [path, content] of Object.entries(files)) {
    vfs.writeFile(path, content);
  }
  return new WorkspaceScope(ROOT, vfs);
}

describe("rewriteMovedFileOwnImports", () => {
  describe("relative import rewriting", () => {
    it("rewrites relative imports when directory depth changes", () => {
      const scope = makeScope({
        "/project/src/counter.test.ts": `import { useCounter } from "../src/composables/useCounter";\n`,
      });
      rewriteMovedFileOwnImports(
        "/project/tests/counter.test.ts",
        "/project/src/counter.test.ts",
        scope,
      );
      const result = scope.fs.readFile("/project/src/counter.test.ts");
      expect(result).toContain(`from "./composables/useCounter"`);
      expect(result).not.toContain(`from "../src/composables/useCounter"`);
    });

    it("rewrites side-effect imports (no named imports)", () => {
      const scope = makeScope({
        "/project/src/counter.test.ts": `import "../src/setup";\n`,
      });
      rewriteMovedFileOwnImports(
        "/project/tests/counter.test.ts",
        "/project/src/counter.test.ts",
        scope,
      );
      const result = scope.fs.readFile("/project/src/counter.test.ts");
      expect(result).toContain(`import "./setup"`);
      expect(result).not.toContain(`import "../src/setup"`);
    });

    it("rewrites type-only imports", () => {
      const scope = makeScope({
        "/project/src/counter.test.ts": `import type { Counter } from "../src/types";\n`,
      });
      rewriteMovedFileOwnImports(
        "/project/tests/counter.test.ts",
        "/project/src/counter.test.ts",
        scope,
      );
      const result = scope.fs.readFile("/project/src/counter.test.ts");
      expect(result).toContain(`from "./types"`);
      expect(result).not.toContain(`from "../src/types"`);
    });

    it("rewrites re-export declarations", () => {
      const scope = makeScope({
        "/project/src/index.ts": `export { useCounter } from "../src/composables/useCounter";\n`,
      });
      rewriteMovedFileOwnImports("/project/tests/index.ts", "/project/src/index.ts", scope);
      const result = scope.fs.readFile("/project/src/index.ts");
      expect(result).toContain(`from "./composables/useCounter"`);
      expect(result).not.toContain(`from "../src/composables/useCounter"`);
    });
  });

  describe("non-relative specifiers", () => {
    it("leaves bare module specifiers unchanged", () => {
      const content = `import { describe } from "vitest";\n`;
      const scope = makeScope({
        "/project/src/counter.test.ts": content,
      });
      rewriteMovedFileOwnImports(
        "/project/tests/counter.test.ts",
        "/project/src/counter.test.ts",
        scope,
      );
      const result = scope.fs.readFile("/project/src/counter.test.ts");
      expect(result).toContain(`from "vitest"`);
    });

    it("leaves node: protocol specifiers unchanged", () => {
      const content = `import path from "node:path";\n`;
      const scope = makeScope({
        "/project/src/counter.test.ts": content,
      });
      rewriteMovedFileOwnImports(
        "/project/tests/counter.test.ts",
        "/project/src/counter.test.ts",
        scope,
      );
      const result = scope.fs.readFile("/project/src/counter.test.ts");
      expect(result).toContain(`from "node:path"`);
    });
  });

  describe("extension preservation", () => {
    it("preserves .js extension when rewriting relative imports", () => {
      const scope = makeScope({
        "/project/src/counter.test.ts": `import { x } from "../src/foo.js";\n`,
      });
      rewriteMovedFileOwnImports(
        "/project/tests/counter.test.ts",
        "/project/src/counter.test.ts",
        scope,
      );
      const result = scope.fs.readFile("/project/src/counter.test.ts");
      expect(result).toContain(`from "./foo.js"`);
      expect(result).not.toContain(`from "../src/foo.js"`);
    });

    it("preserves .ts extension when rewriting relative imports", () => {
      const scope = makeScope({
        "/project/src/counter.test.ts": `import { x } from "../src/foo.ts";\n`,
      });
      rewriteMovedFileOwnImports(
        "/project/tests/counter.test.ts",
        "/project/src/counter.test.ts",
        scope,
      );
      const result = scope.fs.readFile("/project/src/counter.test.ts");
      expect(result).toContain(`from "./foo.ts"`);
    });
  });

  describe("no-op cases", () => {
    it("does not write when specifiers are unchanged (same-directory rename)", () => {
      const content = `import { x } from "./utils";\n`;
      const scope = makeScope({
        "/project/src/b.ts": content,
      });
      rewriteMovedFileOwnImports("/project/src/a.ts", "/project/src/b.ts", scope);
      expect(scope.modified).not.toContain("/project/src/b.ts");
    });

    it("does not rewrite a specifier that already resolves correctly from the new location (companion move)", () => {
      const scope = makeScope({
        "/project/lib/b.ts": `import { x } from "./a";\n`,
        "/project/lib/a.ts": `export const x = 1;\n`,
      });
      rewriteMovedFileOwnImports("/project/utils/b.ts", "/project/lib/b.ts", scope);
      const result = scope.fs.readFile("/project/lib/b.ts");
      expect(result).toContain(`from "./a"`);
      expect(result).not.toContain(`from "../utils/a"`);
      expect(scope.modified).not.toContain("/project/lib/b.ts");
    });

    it("skips when newPath is already in scope.modified", () => {
      const scope = makeScope({
        "/project/src/counter.test.ts": `import { x } from "../src/foo";\n`,
      });
      scope.recordModified("/project/src/counter.test.ts");
      rewriteMovedFileOwnImports(
        "/project/tests/counter.test.ts",
        "/project/src/counter.test.ts",
        scope,
      );
      const result = scope.fs.readFile("/project/src/counter.test.ts");
      expect(result).toContain(`from "../src/foo"`);
    });

    it("skips when oldPath is already in scope.modified (getEditsForFileRename rewrote it before the physical move)", () => {
      const scope = makeScope({
        "/project/src/counter.test.ts": `import { x } from "./foo";\n`,
      });
      scope.recordModified("/project/tests/counter.test.ts");
      rewriteMovedFileOwnImports(
        "/project/tests/counter.test.ts",
        "/project/src/counter.test.ts",
        scope,
      );
      expect(scope.modified).not.toContain("/project/src/counter.test.ts");
    });
  });

  describe("companion file skipping via bare path", () => {
    it("does not rewrite when companion file exists at the bare specifier path (no extension)", () => {
      const scope = makeScope({
        "/project/lib/b.ts": `import { x } from "./a.js";\n`,
        "/project/lib/a.js": `export const x = 1;\n`,
      });
      rewriteMovedFileOwnImports("/project/utils/b.ts", "/project/lib/b.ts", scope);
      const result = scope.fs.readFile("/project/lib/b.ts");
      expect(result).toContain(`from "./a.js"`);
      expect(scope.modified).not.toContain("/project/lib/b.ts");
    });
  });

  describe("dot-prefix normalisation", () => {
    it("adds ./ prefix when path.relative returns a bare filename (moved to sibling dir)", () => {
      // Moving from /project/src/sub/b.ts to /project/src/b.ts.
      // Specifier "./a" from sub/ resolves to /project/src/sub/a.
      // path.relative("/project/src", "/project/src/sub/a") = "sub/a" — no leading dot.
      // Guard must prepend "./" → "./sub/a".
      const scope = makeScope({
        "/project/src/b.ts": `import { x } from "./a";\n`,
      });
      rewriteMovedFileOwnImports("/project/src/sub/b.ts", "/project/src/b.ts", scope);
      const result = scope.fs.readFile("/project/src/b.ts");
      expect(result).toContain(`from "./sub/a"`);
      expect(result).not.toContain(`from "sub/a"`);
    });

    it("does not double-prefix a specifier that path.relative already starts with ./", () => {
      // Move from /project/lib/sub/b.ts to /project/lib/b.ts.
      // Specifier "./sibling" from sub/ resolves to /project/lib/sub/sibling.
      // From lib/, path.relative gives "../lib/sub/sibling"... no. Let's use a case where
      // the relative result starts with "./" naturally and must not become "././" .
      const scope = makeScope({
        "/project/lib/b.ts": `import { x } from "../../other/a";\n`,
      });
      rewriteMovedFileOwnImports("/project/deep/nested/b.ts", "/project/lib/b.ts", scope);
      const result = scope.fs.readFile("/project/lib/b.ts");
      expect(result).not.toContain(`from "./../`);
      expect(result).not.toContain(`from "././`);
    });
  });

  describe("scope tracking", () => {
    it("records the file as modified when changes are made", () => {
      const scope = makeScope({
        "/project/src/counter.test.ts": `import { x } from "../src/foo";\n`,
      });
      rewriteMovedFileOwnImports(
        "/project/tests/counter.test.ts",
        "/project/src/counter.test.ts",
        scope,
      );
      expect(scope.modified).toContain("/project/src/counter.test.ts");
    });
  });
});
