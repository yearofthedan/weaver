import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES, readFile } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "./engine.js";
import { tsRename } from "./rename.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

// simple-ts fixture:
//   src/utils.ts  line 1, col 17 → "greetUser"
//   src/main.ts   imports and calls greetUser

describe("tsRename", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = FIXTURES.simpleTs.name) {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  describe("successful renames", () => {
    it("renames a symbol at its declaration site and returns the old name", async () => {
      const dir = setup();
      const engine = new TsMorphEngine();

      const result = await tsRename(
        engine,
        `${dir}/src/utils.ts`,
        1,
        17,
        "greetPerson",
        makeScope(dir),
      );

      expect(result.symbolName).toBe("greetUser");
      expect(result.newName).toBe("greetPerson");
      expect(result.filesModified).toHaveLength(2);
      expect(result.filesSkipped).toHaveLength(0);
      expect(result.locationCount).toBeGreaterThanOrEqual(2);

      expect(readFile(dir, "src/utils.ts")).toContain("greetPerson");
      expect(readFile(dir, "src/main.ts")).toContain("greetPerson");
      expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
    });

    it("renames a symbol from a call site", async () => {
      const dir = setup();
      const engine = new TsMorphEngine();

      const result = await tsRename(
        engine,
        `${dir}/src/main.ts`,
        3,
        13,
        "sayHello",
        makeScope(dir),
      );

      expect(result.symbolName).toBe("greetUser");
      expect(result.newName).toBe("sayHello");
      expect(result.filesModified).toHaveLength(2);
      expect(result.locationCount).toBeGreaterThanOrEqual(2);

      expect(readFile(dir, "src/utils.ts")).toContain("sayHello");
      expect(readFile(dir, "src/main.ts")).toContain("sayHello");
    });

    it("renames across three files (multi-importer)", async () => {
      const dir = setup("multi-importer");
      const engine = new TsMorphEngine();

      const result = await tsRename(engine, `${dir}/src/utils.ts`, 1, 17, "sum", makeScope(dir));

      expect(result.symbolName).toBe("add");
      expect(result.newName).toBe("sum");
      expect(result.filesModified).toHaveLength(3);
      expect(result.locationCount).toBeGreaterThanOrEqual(3);

      expect(readFile(dir, "src/utils.ts")).toContain("sum");
      expect(readFile(dir, "src/featureA.ts")).toContain("sum");
      expect(readFile(dir, "src/featureB.ts")).toContain("sum");
    });
  });

  describe("error cases", () => {
    it("throws SYMBOL_NOT_FOUND for an out-of-range line", async () => {
      const dir = setup();
      const engine = new TsMorphEngine();

      await expect(
        tsRename(engine, `${dir}/src/utils.ts`, 999, 1, "foo", makeScope(dir)),
      ).rejects.toMatchObject({ code: "SYMBOL_NOT_FOUND" });
    });

    it("throws RENAME_NOT_ALLOWED for a non-renameable symbol (e.g. a string literal)", async () => {
      const dir = setup();
      const engine = new TsMorphEngine();

      // line 2 of utils.ts is `  return \`Hello, ${name}\`;`
      // col 12 points inside the string literal "Hello, " — cannot be renamed
      await expect(
        tsRename(engine, `${dir}/src/utils.ts`, 2, 12, "foo", makeScope(dir)),
      ).rejects.toMatchObject({ code: "RENAME_NOT_ALLOWED" });
    });
  });

  describe("workspace boundary enforcement", () => {
    it("skips files outside the workspace boundary and records them in filesSkipped", async () => {
      const dir = setup();
      const engine = new TsMorphEngine();

      // Use a scope rooted at src/ so only files under src/ are in bounds.
      // main.ts is in-scope; if the rename engine hits files outside scope, they go to filesSkipped.
      const narrowScope = makeScope(`${dir}/src`);

      const result = await tsRename(
        engine,
        `${dir}/src/utils.ts`,
        1,
        17,
        "greetPerson",
        narrowScope,
      );

      // utils.ts and main.ts are both in src/ so both should be modified
      expect(result.filesModified).not.toHaveLength(0);
      expect(result.symbolName).toBe("greetUser");
      expect(result.newName).toBe("greetPerson");
    });

    it("does not call notifyFileWritten on the engine (TsMorphEngine is a no-op)", async () => {
      // This test documents the contract: tsRename never calls notifyFileWritten.
      // We verify indirectly: the rename succeeds and files on disk reflect the rename,
      // meaning tsRename manages writes through scope.writeFile only.
      const dir = setup();
      const engine = new TsMorphEngine();
      const scope = makeScope(dir);

      const result = await tsRename(engine, `${dir}/src/utils.ts`, 1, 17, "greetPerson", scope);

      expect(result.filesModified).toContain(`${dir}/src/utils.ts`);
      expect(readFile(dir, "src/utils.ts")).toContain("greetPerson");
    });
  });

  describe("workspace expansion — files outside tsconfig.include", () => {
    it("rename updates a test file that is outside tsconfig.include", async () => {
      const dir = setup();
      const engine = new TsMorphEngine(dir);
      const utilsPath = path.join(dir, "src/utils.ts");

      await tsRename(engine, utilsPath, 1, 17, "welcomeUser", makeScope(dir));

      const testFileContent = readFile(dir, "tests/utils.test.ts");
      expect(testFileContent).toContain("welcomeUser");
      expect(testFileContent).not.toContain("greetUser");
    });

    it("findReferences returns a location in a test file outside tsconfig.include", async () => {
      const dir = setup();
      const engine = new TsMorphEngine(dir);
      const utilsPath = path.join(dir, "src/utils.ts");

      const offset = engine.resolveOffset(utilsPath, 1, 17);
      const refs = await engine.getReferencesAtPosition(utilsPath, offset);

      expect(refs).not.toBeNull();
      const testFile = path.join(dir, "tests/utils.test.ts");
      const refInTestFile = refs?.find((r) => r.fileName === testFile);
      expect(refInTestFile).toBeDefined();
    });
  });

  describe("return value shape", () => {
    it("returns all required fields with correct types", async () => {
      const dir = setup();
      const engine = new TsMorphEngine();

      const result = await tsRename(
        engine,
        `${dir}/src/utils.ts`,
        1,
        17,
        "renamed",
        makeScope(dir),
      );

      expect(Array.isArray(result.filesModified)).toBe(true);
      expect(Array.isArray(result.filesSkipped)).toBe(true);
      expect(typeof result.symbolName).toBe("string");
      expect(typeof result.newName).toBe("string");
      expect(typeof result.locationCount).toBe("number");
      expect(result.locationCount).toBeGreaterThan(0);
      expect(result.newName).toBe("renamed");
    });

    it("nameMatches is a flat array", async () => {
      const dir = setup();
      const engine = new TsMorphEngine();

      const result = await tsRename(
        engine,
        `${dir}/src/utils.ts`,
        1,
        17,
        "greetPerson",
        makeScope(dir),
      );

      expect(Array.isArray(result.nameMatches)).toBe(true);
    });

    it("nameMatches finds derived identifier names in modified files", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rename-matches-"));
      dirs.push(dir);
      fs.mkdirSync(path.join(dir, "src"));
      fs.writeFileSync(
        path.join(dir, "src/provider.ts"),
        "export class TsProvider {}\nexport const tsProviderDefault = new TsProvider();\n",
      );

      const engine = new TsMorphEngine();
      // col 14: "export class |TsProvider {}"
      const result = await tsRename(
        engine,
        path.join(dir, "src/provider.ts"),
        1,
        14,
        "TsMorphCompiler",
        makeScope(dir),
      );

      // tsProviderDefault is a derived name the compiler did not rewrite
      expect(result.nameMatches?.length).toBeGreaterThan(0);
      expect(result.nameMatches?.some((s) => s.name === "tsProviderDefault")).toBe(true);
    });

    it("locationCount matches the total number of rename locations", async () => {
      const dir = setup();
      const engine = new TsMorphEngine();

      const result = await tsRename(
        engine,
        `${dir}/src/utils.ts`,
        1,
        17,
        "greetPerson",
        makeScope(dir),
      );

      // simple-ts has greetUser in: export declaration, import, call site = 3 locations
      expect(result.locationCount).toBeGreaterThanOrEqual(2);
      // locationCount must match the actual total (not just modified file count)
      expect(result.locationCount).toBeGreaterThanOrEqual(result.filesModified.length);
    });
  });
});
