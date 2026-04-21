import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { findNonExportedDeclaration } from "./non-exported-declaration.js";

function makeProject() {
  return new Project({ useInMemoryFileSystem: true });
}

describe("findNonExportedDeclaration", () => {
  describe("returns null when no matching declaration exists", () => {
    it("returns null for an empty file", () => {
      const project = makeProject();
      const sf = project.createSourceFile("/dst.ts", "");

      expect(findNonExportedDeclaration(sf, "Foo")).toBeNull();
    });

    it("returns null when only unrelated declarations exist", () => {
      const project = makeProject();
      const sf = project.createSourceFile("/dst.ts", "function Bar(): void {}\n");

      expect(findNonExportedDeclaration(sf, "Foo")).toBeNull();
    });
  });

  describe("returns null when declaration is exported", () => {
    it.each([
      ["function", "export function Foo(): void {}\n"],
      ["class", "export class Foo {}\n"],
      ["interface", "export interface Foo { x: number }\n"],
      ["type alias", "export type Foo = string;\n"],
      ["const variable", "export const Foo = 1;\n"],
    ])("returns null for exported %s", (_kind, content) => {
      const project = makeProject();
      const sf = project.createSourceFile("/dst.ts", content);

      expect(findNonExportedDeclaration(sf, "Foo")).toBeNull();
    });
  });

  describe("returns the declaration node for non-exported declarations", () => {
    it.each([
      ["function", "function Foo(): void {}\nexport function other(): void {}\n"],
      ["class", "class Foo {}\nexport function other(): void {}\n"],
      ["interface", "interface Foo { x: number }\nexport function other(): void {}\n"],
      ["type alias", "type Foo = string;\nexport function other(): void {}\n"],
      ["const variable", "const Foo = 1;\nexport function other(): void {}\n"],
    ])("finds non-exported %s", (_kind, content) => {
      const project = makeProject();
      const sf = project.createSourceFile("/dst.ts", content);

      const result = findNonExportedDeclaration(sf, "Foo");

      expect(result).not.toBeNull();
      expect(typeof result?.remove).toBe("function");
    });

    it("returned node can be removed without error", () => {
      const project = makeProject();
      const sf = project.createSourceFile(
        "/dst.ts",
        "function Foo(): void {}\nexport function other(): void {}\n",
      );

      const result = findNonExportedDeclaration(sf, "Foo");
      result?.remove();

      expect(sf.getText()).not.toContain("function Foo");
      expect(sf.getText()).toContain("other");
    });
  });
});
