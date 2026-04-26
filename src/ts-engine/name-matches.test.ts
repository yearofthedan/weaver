import { Project, SyntaxKind } from "ts-morph";
import { describe, expect, it } from "vitest";
import { type ExcludePosition, scanNameMatches } from "./name-matches.js";

function makeProject(files: Record<string, string>): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, content] of Object.entries(files)) {
    project.createSourceFile(path, content);
  }
  return project;
}

function offsetOf(project: Project, filePath: string, identifierText: string): number {
  const sf = project.getSourceFile(filePath);
  if (!sf) throw new Error(`Source file not found: ${filePath}`);
  const node = sf
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .find((id) => id.getText() === identifierText);
  if (!node) throw new Error(`Identifier "${identifierText}" not found in ${filePath}`);
  return node.getStart();
}

describe("scanNameMatches", () => {
  describe("basic matching", () => {
    it("returns empty array when no identifiers contain the old name", () => {
      const project = makeProject({
        "/src/foo.ts": `const unrelated = 1;\n`,
      });
      const result = scanNameMatches(project, "TsProvider", ["/src/foo.ts"], []);
      expect(result).toEqual([]);
    });

    it("finds identifiers whose names contain oldName as a substring", () => {
      const project = makeProject({
        "/src/foo.ts": `const TsProviderSingleton = 1;\n`,
      });
      const result = scanNameMatches(project, "TsProvider", ["/src/foo.ts"], []);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        file: "/src/foo.ts",
        name: "TsProviderSingleton",
        line: 1,
        col: 7,
      });
    });

    it("finds camelCase derivatives when oldName starts with uppercase (first-char toggle)", () => {
      const project = makeProject({
        "/src/foo.ts": `const tsProviderSingleton = 1;\n`,
      });
      const result = scanNameMatches(project, "TsProvider", ["/src/foo.ts"], []);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("tsProviderSingleton");
    });

    it("finds PascalCase derivatives when oldName starts with lowercase", () => {
      const project = makeProject({
        "/src/foo.ts": `class TsProviderFactory {}\n`,
      });
      const result = scanNameMatches(project, "tsProvider", ["/src/foo.ts"], []);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("TsProviderFactory");
    });

    it("finds matches across multiple files", () => {
      const project = makeProject({
        "/src/a.ts": `const tsProviderA = 1;\n`,
        "/src/b.ts": `const tsProviderB = 2;\n`,
      });
      const result = scanNameMatches(project, "TsProvider", ["/src/a.ts", "/src/b.ts"], []);
      expect(result).toHaveLength(2);
      const files = result.map((m) => m.file);
      expect(files).toContain("/src/a.ts");
      expect(files).toContain("/src/b.ts");
    });
  });

  describe("exclude positions", () => {
    it("skips identifiers at excluded positions", () => {
      const project = makeProject({
        "/src/foo.ts": `const TsProvider = 1;\nconst TsProviderHelper = 2;\n`,
      });
      const excluded: ExcludePosition[] = [
        { file: "/src/foo.ts", offset: offsetOf(project, "/src/foo.ts", "TsProvider") },
      ];
      const result = scanNameMatches(project, "TsProvider", ["/src/foo.ts"], excluded);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("TsProviderHelper");
    });

    it("returns empty when all matches are excluded", () => {
      const project = makeProject({
        "/src/foo.ts": `const TsProvider = 1;\n`,
      });
      const excluded: ExcludePosition[] = [
        { file: "/src/foo.ts", offset: offsetOf(project, "/src/foo.ts", "TsProvider") },
      ];
      const result = scanNameMatches(project, "TsProvider", ["/src/foo.ts"], excluded);
      expect(result).toEqual([]);
    });
  });

  describe("AST-only walk — no string literals or comments", () => {
    it("does not match oldName inside string literals", () => {
      const project = makeProject({
        "/src/foo.ts": `const label = "TsProvider";\n`,
      });
      const result = scanNameMatches(project, "TsProvider", ["/src/foo.ts"], []);
      expect(result).toHaveLength(0);
    });

    it("does not match oldName in comments", () => {
      const project = makeProject({
        "/src/foo.ts": `// TsProvider is cool\nconst x = 1;\n`,
      });
      const result = scanNameMatches(project, "TsProvider", ["/src/foo.ts"], []);
      expect(result).toHaveLength(0);
    });
  });

  describe("no cap — returns all matches", () => {
    it("returns all matches when there are more than 10", () => {
      const lines = Array.from({ length: 15 }, (_, i) => `const TsProviderItem${i} = ${i};`).join(
        "\n",
      );
      const project = makeProject({ "/src/foo.ts": `${lines}\n` });
      const result = scanNameMatches(project, "TsProvider", ["/src/foo.ts"], []);
      expect(result).toHaveLength(15);
    });
  });

  describe("kind field", () => {
    it("reports the parent SyntaxKind name", () => {
      const project = makeProject({
        "/src/foo.ts": `function createTsProvider() {}\n`,
      });
      const result = scanNameMatches(project, "TsProvider", ["/src/foo.ts"], []);
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe("FunctionDeclaration");
    });

    it("reports VariableDeclaration kind for variable names", () => {
      const project = makeProject({
        "/src/foo.ts": `const tsProviderInstance = {};\n`,
      });
      const result = scanNameMatches(project, "TsProvider", ["/src/foo.ts"], []);
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe("VariableDeclaration");
    });
  });

  describe("skips files not in project", () => {
    it("silently skips paths not in the project", () => {
      const project = makeProject({ "/src/foo.ts": `const x = 1;\n` });
      const result = scanNameMatches(project, "TsProvider", ["/src/missing.ts"], []);
      expect(result).toEqual([]);
    });
  });
});
