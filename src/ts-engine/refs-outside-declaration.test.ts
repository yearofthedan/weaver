import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { hasRefsOutsideDeclaration } from "./refs-outside-declaration.js";

function makeProject() {
  return new Project({ useInMemoryFileSystem: true });
}

describe("hasRefsOutsideDeclaration", () => {
  describe("returns true when remaining code references the symbol", () => {
    it("detects reference in another function body", () => {
      const project = makeProject();
      const srcSF = project.createSourceFile(
        "/a.ts",
        "export function Foo(): string { return 'foo'; }\nexport function Bar(): string { return Foo(); }\n",
      );
      const declStmt = srcSF.getFunctionOrThrow("Foo");

      expect(hasRefsOutsideDeclaration(srcSF, declStmt)).toBe(true);
    });

    it("detects reference at module scope outside the declaration", () => {
      const project = makeProject();
      const srcSF = project.createSourceFile(
        "/a.ts",
        "export function Foo(): string { return 'foo'; }\nexport const result = Foo();\n",
      );
      const declStmt = srcSF.getFunctionOrThrow("Foo");

      expect(hasRefsOutsideDeclaration(srcSF, declStmt)).toBe(true);
    });
  });

  describe("returns false when symbol is only used inside its own declaration", () => {
    it("returns false for a recursive function with no external references", () => {
      const project = makeProject();
      const srcSF = project.createSourceFile(
        "/a.ts",
        "export function Foo(n: number): number { return n <= 0 ? 0 : Foo(n - 1); }\n",
      );
      const declStmt = srcSF.getFunctionOrThrow("Foo");

      expect(hasRefsOutsideDeclaration(srcSF, declStmt)).toBe(false);
    });

    it("returns false when the other function does not reference this declaration", () => {
      const project = makeProject();
      const srcSF = project.createSourceFile(
        "/a.ts",
        "export function Foo(): string { return 'foo'; }\nexport function Bar(): string { return 'bar'; }\n",
      );
      const declStmt = srcSF.getFunctionOrThrow("Foo");

      expect(hasRefsOutsideDeclaration(srcSF, declStmt)).toBe(false);
    });
  });

  describe("returns false when an identifier shadows the name", () => {
    it("does not treat a shadowed local variable as a reference to the declaration", () => {
      const project = makeProject();
      const srcSF = project.createSourceFile(
        "/a.ts",
        "export const Foo = 'original';\nexport function Bar(): string {\n  const Foo = 'shadowed';\n  return Foo;\n}\n",
      );
      const declStmt = srcSF.getVariableStatementOrThrow(
        (vs) => vs.getDeclarations()[0].getName() === "Foo",
      );

      expect(hasRefsOutsideDeclaration(srcSF, declStmt)).toBe(false);
    });
  });
});
