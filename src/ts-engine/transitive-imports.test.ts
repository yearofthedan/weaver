import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { collectTransitiveImports } from "./transitive-imports.js";

function makeProject() {
  return new Project({ useInMemoryFileSystem: true });
}

describe("collectTransitiveImports", () => {
  describe("basic import carry", () => {
    it("returns import entry when declaration references a named import", () => {
      const project = makeProject();
      project.createSourceFile("/types.ts", "export type Bar = { value: string };\n");
      const srcSF = project.createSourceFile(
        "/source.ts",
        'import { Bar } from "./types";\nexport function Foo(b: Bar): string { return b.value; }\n',
      );
      const declStmt = srcSF.getFunctionOrThrow("Foo");

      const result = collectTransitiveImports(srcSF, declStmt);

      expect(result).toHaveLength(1);
      expect(result[0].resolvedAbsPath).toBe("/types.ts");
      expect(result[0].namedImports).toEqual([{ name: "Bar" }]);
    });

    it("returns empty array when declaration has no external references", () => {
      const project = makeProject();
      const srcSF = project.createSourceFile(
        "/source.ts",
        "export function Foo(): string { return 'hello'; }\n",
      );
      const declStmt = srcSF.getFunctionOrThrow("Foo");

      const result = collectTransitiveImports(srcSF, declStmt);

      expect(result).toHaveLength(0);
    });
  });

  describe("alias preservation", () => {
    it("preserves import alias when the declaration uses an aliased import", () => {
      const project = makeProject();
      project.createSourceFile("/types.ts", "export type Bar = { value: string };\n");
      const srcSF = project.createSourceFile(
        "/source.ts",
        'import { Bar as B } from "./types";\nexport function Foo(b: B): string { return b.value; }\n',
      );
      const declStmt = srcSF.getFunctionOrThrow("Foo");

      const result = collectTransitiveImports(srcSF, declStmt);

      expect(result).toHaveLength(1);
      expect(result[0].namedImports).toEqual([{ name: "Bar", alias: "B" }]);
    });
  });

  describe("deduplication", () => {
    it("deduplicates multiple references to the same import from the same module", () => {
      const project = makeProject();
      project.createSourceFile(
        "/types.ts",
        "export type Bar = { value: string };\nexport type Baz = { count: number };\n",
      );
      const srcSF = project.createSourceFile(
        "/source.ts",
        'import { Bar, Baz } from "./types";\nexport function Foo(b: Bar, c: Baz): string { return b.value + c.count; }\n',
      );
      const declStmt = srcSF.getFunctionOrThrow("Foo");

      const result = collectTransitiveImports(srcSF, declStmt);

      expect(result).toHaveLength(1);
      expect(result[0].resolvedAbsPath).toBe("/types.ts");
      expect(result[0].namedImports).toHaveLength(2);
      const names = result[0].namedImports.map((ni) => ni.name);
      expect(names).toContain("Bar");
      expect(names).toContain("Baz");
    });

    it("does not duplicate a named import referenced multiple times in the declaration", () => {
      const project = makeProject();
      project.createSourceFile("/types.ts", "export type Bar = { value: string };\n");
      const srcSF = project.createSourceFile(
        "/source.ts",
        'import { Bar } from "./types";\nexport function Foo(a: Bar, b: Bar): string { return a.value + b.value; }\n',
      );
      const declStmt = srcSF.getFunctionOrThrow("Foo");

      const result = collectTransitiveImports(srcSF, declStmt);

      expect(result).toHaveLength(1);
      expect(result[0].namedImports).toHaveLength(1);
    });
  });

  describe("skip locally-defined identifiers", () => {
    it("does not carry imports for names defined locally in the source file", () => {
      const project = makeProject();
      const srcSF = project.createSourceFile(
        "/source.ts",
        "type LocalType = { value: string };\nexport function Foo(b: LocalType): string { return b.value; }\n",
      );
      const declStmt = srcSF.getFunctionOrThrow("Foo");

      const result = collectTransitiveImports(srcSF, declStmt);

      expect(result).toHaveLength(0);
    });
  });

  describe("skip TypeScript lib types", () => {
    it("does not carry built-in TypeScript library types", () => {
      const project = makeProject();
      const srcSF = project.createSourceFile(
        "/source.ts",
        "export function Foo(items: string[]): Promise<number> { return Promise.resolve(items.length); }\n",
      );
      const declStmt = srcSF.getFunctionOrThrow("Foo");

      const result = collectTransitiveImports(srcSF, declStmt);

      expect(result).toHaveLength(0);
    });
  });

  describe("multiple imports from same module", () => {
    it("groups multiple named imports from the same module into a single entry", () => {
      const project = makeProject();
      project.createSourceFile("/shared.ts", "export type A = string;\nexport type B = number;\n");
      const srcSF = project.createSourceFile(
        "/source.ts",
        'import { A, B } from "./shared";\nexport function Foo(a: A, b: B): string { return String(b); }\n',
      );
      const declStmt = srcSF.getFunctionOrThrow("Foo");

      const result = collectTransitiveImports(srcSF, declStmt);

      expect(result).toHaveLength(1);
      expect(result[0].resolvedAbsPath).toBe("/shared.ts");
    });
  });
});
