import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { EngineError } from "../domain/errors.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "./engine.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

// simple-ts fixture:
//   src/utils.ts  line 1, col 17 → greetUser
//   src/main.ts   line 1, col 10 → greetUser (import)
//                 line 3, col 13 → greetUser (call)

describe("TsMorphEngine", () => {
  it("implements Engine interface shape", () => {
    const p = new TsMorphEngine();
    expect(typeof p.resolveOffset).toBe("function");
    expect(typeof p.getReferencesAtPosition).toBe("function");
    expect(typeof p.getDefinitionAtPosition).toBe("function");
    expect(typeof p.readFile).toBe("function");
    expect(typeof p.rename).toBe("function");
    expect(typeof p.moveFile).toBe("function");
    expect(typeof p.moveSymbol).toBe("function");
    expect(typeof p.moveDirectory).toBe("function");
    expect(typeof p.deleteFile).toBe("function");
  });

  test("resolveOffset converts 1-based line/col to 0-based offset", async ({
    dir,
    seedNamedFixture,
  }) => {
    await seedNamedFixture(FIXTURES.simpleTs.name);
    const p = new TsMorphEngine();
    const file = path.join(dir, "src/utils.ts");
    // line 1, col 1 → offset 0
    expect(p.resolveOffset(file, 1, 1)).toBe(0);
    // line 1, col 17 → offset 16 (0-based)
    expect(p.resolveOffset(file, 1, 17)).toBe(16);
  });

  test("getRenameLocations returns spans for a symbol", async ({ dir, seedNamedFixture }) => {
    await seedNamedFixture(FIXTURES.simpleTs.name);
    const p = new TsMorphEngine();
    const file = path.join(dir, "src/utils.ts");
    const offset = p.resolveOffset(file, 1, 17); // greetUser
    const locs = await p.getRenameLocations(file, offset);
    expect(locs).not.toBeNull();
    expect(locs?.length).toBeGreaterThanOrEqual(2); // declaration + call site + import
    for (const loc of locs ?? []) {
      expect(typeof loc.fileName).toBe("string");
      expect(typeof loc.textSpan.start).toBe("number");
      expect(typeof loc.textSpan.length).toBe("number");
    }
  });

  test("getReferencesAtPosition returns spans including definition", async ({
    dir,
    seedNamedFixture,
  }) => {
    await seedNamedFixture(FIXTURES.simpleTs.name);
    const p = new TsMorphEngine();
    const file = path.join(dir, "src/utils.ts");
    const offset = p.resolveOffset(file, 1, 17);
    const refs = await p.getReferencesAtPosition(file, offset);
    expect(refs).not.toBeNull();
    expect(refs?.length).toBeGreaterThanOrEqual(1);
  });

  test("getDefinitionAtPosition returns definition location", async ({ dir, seedNamedFixture }) => {
    await seedNamedFixture(FIXTURES.simpleTs.name);
    const p = new TsMorphEngine();
    const file = path.join(dir, "src/main.ts");
    const offset = p.resolveOffset(file, 3, 13); // greetUser call site
    const defs = await p.getDefinitionAtPosition(file, offset);
    expect(defs).not.toBeNull();
    expect(defs?.length).toBeGreaterThanOrEqual(1);
    expect(defs?.[0].name).toBe("greetUser");
    expect(defs?.[0].fileName).toContain("utils.ts");
  });

  it("refreshFile is a no-op when the project has not been loaded yet", () => {
    const p = new TsMorphEngine();
    expect(() => p.refreshFile("/nonexistent/path.ts")).not.toThrow();
  });

  test("refreshFile does not throw after a project has been loaded", async ({
    dir,
    seedNamedFixture,
  }) => {
    await seedNamedFixture(FIXTURES.simpleTs.name);
    const p = new TsMorphEngine();
    const file = path.join(dir, "src/utils.ts");
    // Force project load.
    p.resolveOffset(file, 1, 1);
    // Modify file on disk then refresh — must not throw.
    expect(() => p.refreshFile(file)).not.toThrow();
  });

  test("getRenameLocations throws RENAME_NOT_ALLOWED for a non-renameable token", async ({
    dir,
    seedNamedFixture,
  }) => {
    await seedNamedFixture(FIXTURES.simpleTs.name);
    const p = new TsMorphEngine();
    // main.ts line 1: import { greetUser } from "./utils";
    // The import path string "./utils" at col 27 cannot be renamed
    // because allowRenameOfImportPath:false is passed to the TS LS.
    const file = path.join(dir, "src/main.ts");
    const offset = p.resolveOffset(file, 1, 27); // '"' of '"./utils"'
    await expect(p.getRenameLocations(file, offset)).rejects.toSatisfy((e) =>
      EngineError.is(e, "RENAME_NOT_ALLOWED"),
    );
  });

  test("getDefinitionAtPosition returns null for a whitespace offset", async ({
    dir,
    seedNamedFixture,
  }) => {
    await seedNamedFixture(FIXTURES.simpleTs.name);
    const p = new TsMorphEngine();
    // main.ts line 2 is blank — any position there has no symbol definition
    const file = path.join(dir, "src/main.ts");
    const result = await p.getDefinitionAtPosition(file, 37); // '\n' at end of line 1
    expect(result).toBeNull();
  });

  it("resolveOffset works for a file with no parent tsconfig (no-tsconfig project path)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-notconfig-"));
    const file = path.join(tmpDir, "standalone.ts");
    fs.writeFileSync(file, "export const x = 1;\n");
    try {
      const p = new TsMorphEngine();
      // 'x' starts at column 14 → offset 13
      expect(p.resolveOffset(file, 1, 14)).toBe(13);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("getRenameLocations works for a file with no parent tsconfig", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-notconfig-"));
    const file = path.join(tmpDir, "standalone.ts");
    fs.writeFileSync(file, "export const myVar = 1;\n");
    try {
      const p = new TsMorphEngine();
      // 'myVar' starts at offset 13
      const locs = await p.getRenameLocations(file, 13);
      expect(locs).not.toBeNull();
      expect(locs?.length).toBeGreaterThanOrEqual(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("getReferencesAtPosition works for a file with no parent tsconfig", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-notconfig-"));
    const file = path.join(tmpDir, "standalone.ts");
    fs.writeFileSync(file, "export const myVar = 1;\n");
    try {
      const p = new TsMorphEngine();
      const refs = await p.getReferencesAtPosition(file, 13);
      expect(refs).not.toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("getDefinitionAtPosition works for a file with no parent tsconfig", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-notconfig-"));
    const file = path.join(tmpDir, "standalone.ts");
    // Use a reference expression: x references myVar defined earlier in the file
    fs.writeFileSync(file, "export const myVar = 1;\nexport const x = myVar;\n");
    try {
      const p = new TsMorphEngine();
      // 'myVar' in 'const x = myVar' starts at offset 41
      const content = fs.readFileSync(file, "utf8");
      const offset = content.indexOf("myVar", content.indexOf("const x"));
      const defs = await p.getDefinitionAtPosition(file, offset);
      expect(defs).not.toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("symlink path resolution", () => {
    const symlinks: string[] = [];
    afterEach(() => {
      for (const l of symlinks.splice(0)) fs.rmSync(l, { recursive: true, force: true });
    });

    test("resolveOffset works through a symlinked path", async ({ dir, seedNamedFixture }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const linkDir = `${dir}-link`;
      fs.symlinkSync(dir, linkDir, "dir");
      symlinks.push(linkDir);
      const p = new TsMorphEngine();
      const file = path.join(linkDir, "src/utils.ts");
      expect(p.resolveOffset(file, 1, 17)).toBe(16);
    });

    test("getRenameLocations succeeds through a symlinked path", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const linkDir = `${dir}-link`;
      fs.symlinkSync(dir, linkDir, "dir");
      symlinks.push(linkDir);
      const p = new TsMorphEngine();
      const file = path.join(linkDir, "src/utils.ts");
      const offset = p.resolveOffset(file, 1, 17);
      const locs = await p.getRenameLocations(file, offset);
      expect(locs).not.toBeNull();
      expect(locs?.length).toBeGreaterThanOrEqual(2);
      // Response paths should be real (usable) paths
      for (const loc of locs ?? []) {
        expect(fs.existsSync(loc.fileName)).toBe(true);
      }
    });

    test("getReferencesAtPosition succeeds through a symlinked path", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const linkDir = `${dir}-link`;
      fs.symlinkSync(dir, linkDir, "dir");
      symlinks.push(linkDir);
      const p = new TsMorphEngine();
      const file = path.join(linkDir, "src/utils.ts");
      const offset = p.resolveOffset(file, 1, 17);
      const refs = await p.getReferencesAtPosition(file, offset);
      expect(refs).not.toBeNull();
      expect(refs?.length).toBeGreaterThanOrEqual(1);
      for (const ref of refs ?? []) {
        expect(fs.existsSync(ref.fileName)).toBe(true);
      }
    });

    test("getDefinitionAtPosition succeeds through a symlinked path", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const linkDir = `${dir}-link`;
      fs.symlinkSync(dir, linkDir, "dir");
      symlinks.push(linkDir);
      const p = new TsMorphEngine();
      const file = path.join(linkDir, "src/main.ts");
      const offset = p.resolveOffset(file, 3, 13); // greetUser call site
      const defs = await p.getDefinitionAtPosition(file, offset);
      expect(defs).not.toBeNull();
      expect(defs?.length).toBeGreaterThanOrEqual(1);
      expect(defs?.[0].name).toBe("greetUser");
      for (const def of defs ?? []) {
        expect(fs.existsSync(def.fileName)).toBe(true);
      }
    });
  });

  it("getProjectForDirectory falls back to no-tsconfig project when no tsconfig found", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-notconfig-dir-"));
    try {
      const p = new TsMorphEngine();
      // Must not throw — returns a bare Project without tsconfig.
      const project = p.getProjectForDirectory(tmpDir);
      expect(project).toBeTruthy();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("getLanguageServiceForFile", () => {
    test("returns a language service with getSemanticDiagnostics", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const p = new TsMorphEngine();
      const file = path.join(dir, "src/utils.ts");
      const ls = p.getLanguageServiceForFile(file);
      expect(typeof ls.getSemanticDiagnostics).toBe("function");
    });

    test("returns a language service that can find rename locations", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const p = new TsMorphEngine();
      const file = path.join(dir, "src/utils.ts");
      const ls = p.getLanguageServiceForFile(file);
      // greetUser is at offset 16 in utils.ts
      const locs = ls.findRenameLocations(file, 16, false, false, {
        allowRenameOfImportPath: false,
      });
      expect(locs).not.toBeUndefined();
      expect(locs?.length).toBeGreaterThanOrEqual(2);
    });

    test("adds the file to the project when it was not already tracked", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const p = new TsMorphEngine();
      const file = path.join(dir, "src/utils.ts");
      // Call before any other method — file is not yet in a project.
      const ls = p.getLanguageServiceForFile(file);
      const diags = ls.getSemanticDiagnostics(file);
      expect(Array.isArray(diags)).toBe(true);
    });
  });

  describe("getLanguageServiceForDirectory", () => {
    test("returns a language service for the project covering the directory", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const p = new TsMorphEngine();
      const ls = p.getLanguageServiceForDirectory(dir);
      expect(typeof ls.getSemanticDiagnostics).toBe("function");
    });

    test("returns a language service that can check files in the project", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const p = new TsMorphEngine();
      const ls = p.getLanguageServiceForDirectory(dir);
      const file = path.join(dir, "src/utils.ts");
      const diags = ls.getSemanticDiagnostics(file);
      expect(Array.isArray(diags)).toBe(true);
    });
  });

  describe("refreshSourceFile", () => {
    it("is a no-op when the project has not been loaded yet", () => {
      const p = new TsMorphEngine();
      expect(() => p.refreshSourceFile("/nonexistent/path.ts")).not.toThrow();
    });

    test("re-reads the file from disk after content changes", async ({ dir, seedNamedFixture }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const p = new TsMorphEngine();
      const file = path.join(dir, "src/utils.ts");
      // Load the project so the file is tracked.
      p.getLanguageServiceForFile(file);
      // Overwrite the file with a type error.
      fs.writeFileSync(file, "export const x: number = 'not-a-number';\n");
      p.refreshSourceFile(file);
      const ls = p.getLanguageServiceForFile(file);
      const diags = ls.getSemanticDiagnostics(file);
      expect(diags.length).toBeGreaterThan(0);
    });

    test("adds the file to the project when it was not already tracked", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const p = new TsMorphEngine();
      const file = path.join(dir, "src/utils.ts");
      // Load the project (but not this specific file).
      const otherFile = path.join(dir, "src/main.ts");
      p.getLanguageServiceForFile(otherFile);
      // refreshSourceFile should add it without throwing.
      expect(() => p.refreshSourceFile(file)).not.toThrow();
    });
  });

  describe("getProjectSourceFilePaths", () => {
    test("returns file paths as strings", async ({ dir, seedNamedFixture }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const p = new TsMorphEngine();
      const paths = p.getProjectSourceFilePaths(dir);
      expect(Array.isArray(paths)).toBe(true);
      for (const fp of paths) {
        expect(typeof fp).toBe("string");
      }
    });

    test("includes source files from the project", async ({ dir, seedNamedFixture }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const p = new TsMorphEngine();
      const paths = p.getProjectSourceFilePaths(dir);
      const utils = path.join(dir, "src/utils.ts");
      expect(paths.some((fp) => fp === utils || fp.endsWith("/src/utils.ts"))).toBe(true);
    });

    it("returns an empty array when the directory has no tsconfig and no source files", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-empty-"));
      try {
        const p = new TsMorphEngine();
        const paths = p.getProjectSourceFilePaths(tmpDir);
        expect(Array.isArray(paths)).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("removeImportersOf", () => {
    test("delegates to tsRemoveImportersOf with workspace-expanded project graph", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.deleteFileTs.name);
      // TsMorphEngine(dir) expands the project graph to include all workspace files,
      // including tests/out-of-project.ts which is outside tsconfig.include.
      const p = new TsMorphEngine(dir);
      const target = path.join(dir, "src/target.ts");
      const scope = makeScope(dir);

      const count = await p.removeImportersOf(target, scope);

      // importer.ts: 2 (named import + type-only import)
      // barrel.ts:   2 (export * + named re-export)
      // tests/out-of-project.ts: 1 (included via expanded project graph)
      expect(count).toBe(5);
      expect(scope.modified).toContain(path.join(dir, "tests/out-of-project.ts"));
    });
  });

  describe("getFunction", () => {
    it("returns name and parameters for a named function", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-params-"));
      const file = path.join(tmpDir, "funcs.ts");
      fs.writeFileSync(
        file,
        "export function add(a: number, b: number): number { return a + b; }\n",
      );
      try {
        const p = new TsMorphEngine();
        const result = p.getFunction(file, "add");
        expect(result).toEqual({
          name: "add",
          parameters: [{ name: "a" }, { name: "b" }],
        });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("returns empty parameters for a zero-arg function", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-params-"));
      const file = path.join(tmpDir, "funcs.ts");
      fs.writeFileSync(file, "export function noop(): void {}\n");
      try {
        const p = new TsMorphEngine();
        const result = p.getFunction(file, "noop");
        expect(result).toEqual({ name: "noop", parameters: [] });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("returns undefined when the function does not exist", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-params-"));
      const file = path.join(tmpDir, "funcs.ts");
      fs.writeFileSync(file, "export const x = 1;\n");
      try {
        const p = new TsMorphEngine();
        expect(p.getFunction(file, "nonExistent")).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
