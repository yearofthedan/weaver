import ts from "typescript";
import { describe, expect, it } from "vitest";
import { capDiagnostics, semanticErrors, toDiagnostic } from "./get-type-errors.js";

function diagnostic(category: ts.DiagnosticCategory, code: number): ts.Diagnostic {
  return {
    category,
    code,
    file: undefined,
    start: undefined,
    length: undefined,
    messageText: `message ${code}`,
  };
}

function serviceReturning(diagnostics: ts.Diagnostic[]): ts.LanguageService {
  return { getSemanticDiagnostics: () => diagnostics } as unknown as ts.LanguageService;
}

describe("semanticErrors", () => {
  it("keeps errors and drops every other category", () => {
    const ls = serviceReturning([
      diagnostic(ts.DiagnosticCategory.Error, 2307),
      diagnostic(ts.DiagnosticCategory.Warning, 6133),
      diagnostic(ts.DiagnosticCategory.Suggestion, 80001),
      diagnostic(ts.DiagnosticCategory.Message, 90001),
    ]);

    expect(semanticErrors(ls, "/any/file.ts").map((d) => d.code)).toEqual([2307]);
  });
});

describe("capDiagnostics", () => {
  it("reports the true total and flags truncation once past the cap", () => {
    const errors = Array.from({ length: 101 }, (_, i) =>
      diagnostic(ts.DiagnosticCategory.Error, i),
    );

    const result = capDiagnostics(errors);

    expect(result.diagnostics).toHaveLength(100);
    expect(result.errorCount).toBe(101);
    expect(result.truncated).toBe(true);
  });

  it("does not flag truncation at exactly the cap", () => {
    const errors = Array.from({ length: 100 }, (_, i) =>
      diagnostic(ts.DiagnosticCategory.Error, i),
    );

    const result = capDiagnostics(errors);

    expect(result.diagnostics).toHaveLength(100);
    expect(result.errorCount).toBe(100);
    expect(result.truncated).toBe(false);
  });
});

describe("toDiagnostic", () => {
  it("maps a real source position to 1-based line and column", () => {
    const sourceFile = ts.createSourceFile(
      "/project/src/main.ts",
      "const a = 1;\nconst b = 2;\nconst c = 3;\n",
      ts.ScriptTarget.ESNext,
    );
    // Offset of "b" on the second line: 13 chars of line one, then "const ".
    const start = "const a = 1;\n".length + "const ".length;

    const result = toDiagnostic({
      ...diagnostic(ts.DiagnosticCategory.Error, 2322),
      file: sourceFile,
      start,
    });

    expect(result).toEqual({
      file: "/project/src/main.ts",
      line: 2,
      col: 7,
      code: 2322,
      message: "message 2322",
    });
  });

  it("falls back to 1:1 for a diagnostic with no source position", () => {
    const result = toDiagnostic(diagnostic(ts.DiagnosticCategory.Error, 5000));

    expect(result).toMatchObject({ file: "", line: 1, col: 1 });
  });

  it("falls back to 1:1 for a file-level diagnostic that names a file but no offset", () => {
    const sourceFile = ts.createSourceFile(
      "/project/src/main.ts",
      "const a = 1;\n",
      ts.ScriptTarget.ESNext,
    );

    const result = toDiagnostic({
      ...diagnostic(ts.DiagnosticCategory.Error, 6059),
      file: sourceFile,
      start: undefined,
    });

    expect(result).toMatchObject({ file: "/project/src/main.ts", line: 1, col: 1 });
  });

  it("falls back to 1:1 for an offset with no file to resolve it against", () => {
    const result = toDiagnostic({
      ...diagnostic(ts.DiagnosticCategory.Error, 5001),
      file: undefined,
      start: 12,
    });

    expect(result).toMatchObject({ file: "", line: 1, col: 1 });
  });
});
