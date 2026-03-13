import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { SymbolRef } from "../../src/domain/symbol-ref.js";
import { EngineError } from "../../src/utils/errors.js";

function makeSourceFile(content: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("/workspace/src/utils.ts", content);
}

describe("SymbolRef", () => {
  describe("fromExport()", () => {
    describe("successful resolution", () => {
      it("returns a SymbolRef with the correct name", () => {
        const sf = makeSourceFile("export function foo() {}");
        const ref = SymbolRef.fromExport(sf, "foo");
        expect(ref.name).toBe("foo");
      });

      it("returns a SymbolRef with filePath matching the source file path", () => {
        const sf = makeSourceFile("export function foo() {}");
        const ref = SymbolRef.fromExport(sf, "foo");
        expect(ref.filePath).toBe("/workspace/src/utils.ts");
      });

      it("returns a SymbolRef whose declarationText starts with 'export function foo'", () => {
        const sf = makeSourceFile("export function foo() {}");
        const ref = SymbolRef.fromExport(sf, "foo");
        expect(ref.declarationText).toMatch(/^export function foo/);
      });

      it("includes the full declaration text (not a truncated version)", () => {
        const sf = makeSourceFile("export function foo() { return 42; }");
        const ref = SymbolRef.fromExport(sf, "foo");
        expect(ref.declarationText).toContain("return 42");
      });

      it("resolves an exported class", () => {
        const sf = makeSourceFile("export class MyClass {}");
        const ref = SymbolRef.fromExport(sf, "MyClass");
        expect(ref.name).toBe("MyClass");
        expect(ref.declarationText).toMatch(/^export class MyClass/);
      });

      it("resolves when multiple exports are present", () => {
        const sf = makeSourceFile("export function foo() {}\nexport function bar() {}");
        const ref = SymbolRef.fromExport(sf, "bar");
        expect(ref.name).toBe("bar");
        expect(ref.declarationText).toMatch(/^export function bar/);
      });

      it("returns the full VariableStatement for an exported const", () => {
        const sf = makeSourceFile("export const BAR = 42;");
        const ref = SymbolRef.fromExport(sf, "BAR");
        expect(ref.declarationText).toBe("export const BAR = 42;");
      });

      it("declarationText for exported const includes the export keyword and type annotation", () => {
        const sf = makeSourceFile("export const BAZ: number = 99;");
        const ref = SymbolRef.fromExport(sf, "BAZ");
        expect(ref.declarationText).toBe("export const BAZ: number = 99;");
      });
    });

    describe("isDirectExport()", () => {
      it("returns true for a direct export function", () => {
        const sf = makeSourceFile("export function foo() {}");
        const ref = SymbolRef.fromExport(sf, "foo");
        expect(ref.isDirectExport()).toBe(true);
      });

      it("returns true for a direct export class", () => {
        const sf = makeSourceFile("export class MyClass {}");
        const ref = SymbolRef.fromExport(sf, "MyClass");
        expect(ref.isDirectExport()).toBe(true);
      });
    });

    describe("remove()", () => {
      it("calls the remove function on the underlying declaration", () => {
        const project = new Project({ useInMemoryFileSystem: true });
        const sf = project.createSourceFile(
          "/workspace/src/utils.ts",
          "export function foo() {}\nexport function bar() {}",
        );
        const ref = SymbolRef.fromExport(sf, "foo");
        ref.remove();
        expect(sf.getText()).not.toContain("function foo");
      });

      it("does not affect other declarations when removing one symbol", () => {
        const project = new Project({ useInMemoryFileSystem: true });
        const sf = project.createSourceFile(
          "/workspace/src/utils.ts",
          "export function foo() {}\nexport function bar() {}",
        );
        const ref = SymbolRef.fromExport(sf, "foo");
        ref.remove();
        expect(sf.getText()).toContain("function bar");
      });

      it("removes the entire VariableStatement when removing an exported const", () => {
        const project = new Project({ useInMemoryFileSystem: true });
        const sf = project.createSourceFile(
          "/workspace/src/utils.ts",
          "export const BAR = 42;\nexport function bar() {}",
        );
        const ref = SymbolRef.fromExport(sf, "BAR");
        ref.remove();
        expect(sf.getText()).not.toContain("BAR");
        expect(sf.getText()).toContain("function bar");
      });
    });

    describe("SYMBOL_NOT_FOUND error", () => {
      it("throws EngineError when the symbol is not exported", () => {
        const sf = makeSourceFile("export function foo() {}");
        expect(() => SymbolRef.fromExport(sf, "nonexistent")).toThrow(EngineError);
      });

      it("throws with code SYMBOL_NOT_FOUND", () => {
        const sf = makeSourceFile("export function foo() {}");
        expect(() => SymbolRef.fromExport(sf, "nonexistent")).toThrow(
          expect.objectContaining({ code: "SYMBOL_NOT_FOUND" }),
        );
      });

      it("throws SYMBOL_NOT_FOUND for an empty source file", () => {
        const sf = makeSourceFile("");
        expect(() => SymbolRef.fromExport(sf, "anything")).toThrow(
          expect.objectContaining({ code: "SYMBOL_NOT_FOUND" }),
        );
      });

      it("throws SYMBOL_NOT_FOUND for a function that exists but is not exported", () => {
        const sf = makeSourceFile("function foo() {}");
        expect(() => SymbolRef.fromExport(sf, "foo")).toThrow(
          expect.objectContaining({ code: "SYMBOL_NOT_FOUND" }),
        );
      });

      it("error message includes the symbol name", () => {
        const sf = makeSourceFile("export function foo() {}");
        let error: EngineError | undefined;
        try {
          SymbolRef.fromExport(sf, "nonexistent");
        } catch (e) {
          if (e instanceof EngineError) error = e;
        }
        expect(error?.message).toContain("nonexistent");
      });
    });
  });
});
