import * as path from "node:path";
import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { applyTextEdits } from "../utils/text-utils.js";
import { applyExtractSymbol } from "./extract-symbol.js";

function makeLS(fileName: string, content: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(fileName, content);
  return project.getLanguageService().compilerObject;
}

describe("applyExtractSymbol", () => {
  it("substitutes the provided name for the compiler-generated identifier in all edits", () => {
    const content =
      "function run(n: number): void {\n  const doubled = n * 2;\n  console.log(doubled);\n}\n";
    const fileName = "f.ts";
    const ls = makeLS(fileName, content);
    const start = content.indexOf("const doubled");
    const end = content.indexOf("console.log(doubled);") + "console.log(doubled);".length;

    const edits = applyExtractSymbol(ls, fileName, { pos: start, end }, content, "logDoubled");

    const primary = edits.find((e) => path.basename(e.fileName) === "f.ts")!;
    const result = applyTextEdits(content, primary.textChanges);
    expect(result).toContain("function logDoubled");
    expect(result).not.toContain("newFunction");
  });

  it("throws NOT_SUPPORTED when no Extract Symbol refactor is available at the selection", () => {
    const content = "const x = 1;\n";
    const ls = makeLS("f.ts", content);

    expect(() => applyExtractSymbol(ls, "f.ts", { pos: 0, end: 0 }, content, "fn")).toThrow(
      expect.objectContaining({ code: "NOT_SUPPORTED" }),
    );
  });

  it("selects the outermost applicable function scope when multiple scopes are available", () => {
    const content =
      "function outer() {\n  function inner(a: number, b: number) {\n    const sum = a + b;\n  }\n}\n";
    const fileName = "f.ts";
    const ls = makeLS(fileName, content);
    const start = content.indexOf("const sum");
    const end = start + "const sum = a + b;".length;

    const edits = applyExtractSymbol(ls, fileName, { pos: start, end }, content, "add");

    const primary = edits.find((e) => path.basename(e.fileName) === "f.ts")!;
    const result = applyTextEdits(content, primary.textChanges);
    // Module-level extraction: function declaration starts at column 0 (no indentation)
    expect(result).toMatch(/^function add\(/m);
  });
});
