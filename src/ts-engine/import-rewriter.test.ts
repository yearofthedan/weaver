import { describe, expect, it } from "vitest";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { ImportRewriter } from "./import-rewriter.js";

const ROOT = "/project";

function makeScope(files: Record<string, string> = {}): WorkspaceScope {
  const vfs = new InMemoryFileSystem();
  for (const [path, content] of Object.entries(files)) {
    vfs.writeFile(path, content);
  }
  return new WorkspaceScope(ROOT, vfs);
}

function readFile(scope: WorkspaceScope, path: string): string {
  return scope.fs.readFile(path);
}

describe("ImportRewriter", () => {
  const rewriter = new ImportRewriter();

  describe("full-move: all named imports match", () => {
    it("repoints the module specifier to the new destination", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { MyFn } from "./utils.js";\n`,
      });
      rewriter.rewrite(
        ["/project/src/consumer.ts"],
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      const result = readFile(scope, "/project/src/consumer.ts");
      expect(result).toContain(`from "./helpers.js"`);
      expect(result).not.toContain(`from "./utils.js"`);
    });

    it("records the file as modified", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { MyFn } from "./utils.js";\n`,
      });
      rewriter.rewrite(
        ["/project/src/consumer.ts"],
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      expect(scope.modified).toContain("/project/src/consumer.ts");
    });

    it("handles bare specifier (no extension) pointing at source file", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { MyFn } from "./utils";\n`,
      });
      rewriter.rewrite(
        ["/project/src/consumer.ts"],
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      const result = readFile(scope, "/project/src/consumer.ts");
      expect(result).toContain(`from "./helpers.js"`);
      expect(result).not.toContain(`"./utils"`);
    });

    it("handles .ts extension specifier", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { MyFn } from "./utils.ts";\n`,
      });
      rewriter.rewrite(
        ["/project/src/consumer.ts"],
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      const result = readFile(scope, "/project/src/consumer.ts");
      expect(result).toContain(`from "./helpers.js"`);
      expect(result).not.toContain(`"./utils.ts"`);
    });
  });

  describe("partial-move: symbol is one of several imports", () => {
    it("removes symbol from old import and adds a new import from destination", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { MyFn, OtherFn } from "./utils.js";\n`,
      });
      rewriter.rewrite(
        ["/project/src/consumer.ts"],
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      const result = readFile(scope, "/project/src/consumer.ts");
      // Old import keeps OtherFn but NOT MyFn
      expect(result).toMatch(/import\s*\{[^}]*OtherFn[^}]*\}\s*from\s*["']\.\/utils\.js["']/);
      expect(result).not.toMatch(/import\s*\{[^}]*MyFn[^}]*\}\s*from\s*["']\.\/utils\.js["']/);
      // New import has MyFn from helpers
      expect(result).toMatch(/import\s*\{[^}]*MyFn[^}]*\}\s*from\s*["']\.\/helpers\.js["']/);
    });

    it("does not lose the remaining symbol after the split", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { A, B, C } from "./utils.js";\n`,
      });
      rewriter.rewrite(
        ["/project/src/consumer.ts"],
        "B",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      const result = readFile(scope, "/project/src/consumer.ts");
      expect(result).toContain("A");
      expect(result).toContain("C");
      expect(result).toContain(`from "./helpers.js"`);
    });
  });

  describe("merge with existing destination import", () => {
    it("merges a full-move into an existing import — single import declaration for dest", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { MyFn } from "./utils.js";\nimport { ExistingFn } from "./helpers.js";\n`,
      });
      rewriter.rewrite(
        ["/project/src/consumer.ts"],
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      const result = readFile(scope, "/project/src/consumer.ts");
      // Both symbols appear in a single import from helpers
      expect(result).toContain("MyFn");
      expect(result).toContain("ExistingFn");
      // The old utils import is removed entirely
      expect(result).not.toContain(`from "./utils.js"`);
      // Only one import declaration for helpers (merged, not duplicated)
      const helperImports = result.match(/from ["']\.\/helpers\.js["']/g);
      expect(helperImports).toHaveLength(1);
    });

    it("merges a partial-move into an existing import from the destination", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { MyFn, OtherFn } from "./utils.js";\nimport { ExistingFn } from "./helpers.js";\n`,
      });
      rewriter.rewrite(
        ["/project/src/consumer.ts"],
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      const result = readFile(scope, "/project/src/consumer.ts");
      // MyFn merged into existing helpers import
      expect(result).toContain("MyFn");
      expect(result).toContain("ExistingFn");
      // OtherFn stays on the old utils import
      expect(result).toContain("OtherFn");
      expect(result).toContain(`from "./utils.js"`);
      // Only one import from helpers (merged, not a second declaration)
      const helperImports = result.match(/from ["']\.\/helpers\.js["']/g);
      expect(helperImports).toHaveLength(1);
    });
  });

  describe("export re-exports", () => {
    it("repoints a full re-export specifier to the new destination", () => {
      const scope = makeScope({
        "/project/src/barrel.ts": `export { MyFn } from "./utils.js";\n`,
      });
      rewriter.rewrite(
        ["/project/src/barrel.ts"],
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      const result = readFile(scope, "/project/src/barrel.ts");
      expect(result).toContain(`from "./helpers.js"`);
      expect(result).not.toContain(`from "./utils.js"`);
    });

    it("splits a partial re-export into old and new export declarations", () => {
      const scope = makeScope({
        "/project/src/barrel.ts": `export { MyFn, OtherFn } from "./utils.js";\n`,
      });
      rewriter.rewrite(
        ["/project/src/barrel.ts"],
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      const result = readFile(scope, "/project/src/barrel.ts");
      // Old export keeps OtherFn but NOT MyFn
      expect(result).toMatch(/export\s*\{[^}]*OtherFn[^}]*\}\s*from\s*["']\.\/utils\.js["']/);
      expect(result).not.toMatch(/export\s*\{[^}]*MyFn[^}]*\}\s*from\s*["']\.\/utils\.js["']/);
      // New export has MyFn from helpers
      expect(result).toMatch(/export\s*\{[^}]*MyFn[^}]*\}\s*from\s*["']\.\/helpers\.js["']/);
    });
  });

  describe("no-op cases", () => {
    it.each([
      ["symbol not imported at all", `import { SomethingElse } from "./utils.js";\n`],
      [
        "imports from old source but not the moved symbol",
        `import { OtherFn } from "./utils.js";\n`,
      ],
      ["bare export with no module specifier", `const MyFn = () => {};\nexport { MyFn };\n`],
      ["imports symbol from an unrelated module", `import { MyFn } from "./other.js";\n`],
    ])("does not modify file when %s", (_desc, original) => {
      const scope = makeScope({ "/project/src/consumer.ts": original });
      rewriter.rewrite(
        ["/project/src/consumer.ts"],
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      expect(readFile(scope, "/project/src/consumer.ts")).toBe(original);
      expect(scope.modified).not.toContain("/project/src/consumer.ts");
    });

    it("handles an empty files iterable without error", () => {
      const scope = makeScope();
      expect(() =>
        rewriter.rewrite([], "MyFn", "/project/src/utils.ts", "/project/src/helpers.ts", scope),
      ).not.toThrow();
      expect(scope.modified).toHaveLength(0);
    });
  });

  describe("out-of-workspace files", () => {
    it("records a file outside the workspace as skipped without modifying it", () => {
      const scope = makeScope({
        "/external/consumer.ts": `import { MyFn } from "../project/src/utils.js";\n`,
      });
      rewriter.rewrite(
        ["/external/consumer.ts"],
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      expect(scope.skipped).toContain("/external/consumer.ts");
      expect(scope.modified).not.toContain("/external/consumer.ts");
    });

    it("does not write to a file outside the workspace", () => {
      const original = `import { MyFn } from "../project/src/utils.js";\n`;
      const vfs = new InMemoryFileSystem();
      vfs.writeFile("/external/consumer.ts", original);
      const scope = new WorkspaceScope(ROOT, vfs);
      rewriter.rewrite(
        ["/external/consumer.ts"],
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      expect(vfs.readFile("/external/consumer.ts")).toBe(original);
    });
  });

  describe("rewriteScript standalone", () => {
    it("rewrites script content without reading/writing files", () => {
      const content = `import { MyFn } from "./utils.js";\n`;
      const scope = makeScope();
      const result = rewriter.rewriteScript(
        "/project/src/component.ts",
        content,
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      expect(result).toContain(`from "./helpers.js"`);
      expect(result).not.toContain(`from "./utils.js"`);
    });

    it("returns null when no matching declarations found", () => {
      const content = `import { Other } from "./other.js";\n`;
      const scope = makeScope();
      const result = rewriter.rewriteScript(
        "/project/src/component.ts",
        content,
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      expect(result).toBeNull();
    });
  });

  describe("specifier extension matching", () => {
    it("skips a .js specifier that resolves to a real .js file on disk", () => {
      const original = `import { MyFn } from "./utils.js";\n`;
      const vfs = new InMemoryFileSystem();
      vfs.writeFile("/project/src/consumer.ts", original);
      vfs.writeFile("/project/src/utils.js", "// real js file");
      const scope = new WorkspaceScope(ROOT, vfs);
      rewriter.rewrite(
        ["/project/src/consumer.ts"],
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      expect(readFile(scope, "/project/src/consumer.ts")).toBe(original);
      expect(scope.modified).not.toContain("/project/src/consumer.ts");
    });
  });

  describe("cross-directory imports", () => {
    it("computes correct specifiers for files in different directories", () => {
      const scope = makeScope({
        "/project/src/features/feature.ts": `import { MyFn } from "../utils.js";\n`,
      });
      rewriter.rewrite(
        ["/project/src/features/feature.ts"],
        "MyFn",
        "/project/src/utils.ts",
        "/project/src/helpers.ts",
        scope,
      );
      const result = readFile(scope, "/project/src/features/feature.ts");
      expect(result).toContain(`from "../helpers.js"`);
      expect(result).not.toContain(`from "../utils.js"`);
    });
  });
});
