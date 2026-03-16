import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { EngineError } from "../utils/errors.js";
import { TsMorphCompiler } from "./ts.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

// simple-ts fixture:
//   src/utils.ts  line 1, col 17 → greetUser
//   src/main.ts   line 1, col 10 → greetUser (import)
//                 line 3, col 13 → greetUser (call)

describe("TsMorphCompiler", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = FIXTURES.simpleTs.name) {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  it("implements Compiler shape", () => {
    const p = new TsMorphCompiler();
    expect(typeof p.resolveOffset).toBe("function");
    expect(typeof p.getRenameLocations).toBe("function");
    expect(typeof p.getReferencesAtPosition).toBe("function");
    expect(typeof p.getDefinitionAtPosition).toBe("function");
    expect(typeof p.getEditsForFileRename).toBe("function");
    expect(typeof p.readFile).toBe("function");
    expect(typeof p.notifyFileWritten).toBe("function");
    expect(typeof p.afterFileRename).toBe("function");
    expect(typeof p.afterSymbolMove).toBe("function");
  });

  it("resolveOffset converts 1-based line/col to 0-based offset", () => {
    const dir = setup();
    const p = new TsMorphCompiler();
    const file = path.join(dir, "src/utils.ts");
    // line 1, col 1 → offset 0
    expect(p.resolveOffset(file, 1, 1)).toBe(0);
    // line 1, col 17 → offset 16 (0-based)
    expect(p.resolveOffset(file, 1, 17)).toBe(16);
  });

  it("getRenameLocations returns spans for a symbol", async () => {
    const dir = setup();
    const p = new TsMorphCompiler();
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

  it("getReferencesAtPosition returns spans including definition", async () => {
    const dir = setup();
    const p = new TsMorphCompiler();
    const file = path.join(dir, "src/utils.ts");
    const offset = p.resolveOffset(file, 1, 17);
    const refs = await p.getReferencesAtPosition(file, offset);
    expect(refs).not.toBeNull();
    expect(refs?.length).toBeGreaterThanOrEqual(1);
  });

  it("getDefinitionAtPosition returns definition location", async () => {
    const dir = setup();
    const p = new TsMorphCompiler();
    const file = path.join(dir, "src/main.ts");
    const offset = p.resolveOffset(file, 3, 13); // greetUser call site
    const defs = await p.getDefinitionAtPosition(file, offset);
    expect(defs).not.toBeNull();
    expect(defs?.length).toBeGreaterThanOrEqual(1);
    expect(defs?.[0].name).toBe("greetUser");
    expect(defs?.[0].fileName).toContain("utils.ts");
  });

  it("refreshFile is a no-op when the project has not been loaded yet", () => {
    const p = new TsMorphCompiler();
    expect(() => p.refreshFile("/nonexistent/path.ts")).not.toThrow();
  });

  it("refreshFile does not throw after a project has been loaded", () => {
    const dir = setup();
    const p = new TsMorphCompiler();
    const file = path.join(dir, "src/utils.ts");
    // Force project load.
    p.resolveOffset(file, 1, 1);
    // Modify file on disk then refresh — must not throw.
    expect(() => p.refreshFile(file)).not.toThrow();
  });

  it("getRenameLocations throws RENAME_NOT_ALLOWED for a non-renameable token", async () => {
    const dir = setup();
    const p = new TsMorphCompiler();
    // main.ts line 1: import { greetUser } from "./utils";
    // The import path string "./utils" at col 27 cannot be renamed
    // because allowRenameOfImportPath:false is passed to the TS LS.
    const file = path.join(dir, "src/main.ts");
    const offset = p.resolveOffset(file, 1, 27); // '"' of '"./utils"'
    await expect(p.getRenameLocations(file, offset)).rejects.toSatisfy((e) =>
      EngineError.is(e, "RENAME_NOT_ALLOWED"),
    );
  });

  it("getDefinitionAtPosition returns null for a whitespace offset", async () => {
    const dir = setup();
    const p = new TsMorphCompiler();
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
      const p = new TsMorphCompiler();
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
      const p = new TsMorphCompiler();
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
      const p = new TsMorphCompiler();
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
      const p = new TsMorphCompiler();
      // 'myVar' in 'const x = myVar' starts at offset 41
      const content = fs.readFileSync(file, "utf8");
      const offset = content.indexOf("myVar", content.indexOf("const x"));
      const defs = await p.getDefinitionAtPosition(file, offset);
      expect(defs).not.toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("afterFileRename does not touch files outside the workspace boundary", async () => {
    const dir = setup();
    const p = new TsMorphCompiler();
    // Use a narrow workspace that only covers an empty subdirectory.
    // A file outside this boundary that imports the moved file must not be written.
    const narrowDir = path.join(dir, "src", "nested");
    fs.mkdirSync(narrowDir, { recursive: true });
    const outsideFile = path.join(dir, "src/main.ts");
    const originalContent = fs.readFileSync(outsideFile, "utf8");

    const scope = makeScope(narrowDir);
    const oldPath = path.join(dir, "src/utils.ts");
    const newPath = path.join(dir, "src/helpers.ts");
    await p.afterFileRename(oldPath, newPath, scope);

    // main.ts is outside the narrow workspace — must not be modified
    expect(scope.modified).not.toContain(outsideFile);
    expect(fs.readFileSync(outsideFile, "utf8")).toBe(originalContent);
  });

  it("afterFileRename does not rewrite files that do not import the old path", async () => {
    const dir = setup();
    const p = new TsMorphCompiler();
    const mainPath = path.join(dir, "src/main.ts");
    const originalContent = fs.readFileSync(mainPath, "utf8");
    // Moving a file that main.ts doesn't import — main.ts must not be touched.
    const unrelatedOld = path.join(dir, "src/unrelated.ts");
    const unrelatedNew = path.join(dir, "src/other.ts");
    const scope = makeScope(dir);
    await p.afterFileRename(unrelatedOld, unrelatedNew, scope);
    expect(fs.readFileSync(mainPath, "utf8")).toBe(originalContent);
    expect(scope.modified).not.toContain(mainPath);
  });

  it("afterFileRename skips files already in scope.modified", async () => {
    const dir = setup();
    const p = new TsMorphCompiler();
    const mainPath = path.join(dir, "src/main.ts");
    const originalContent = fs.readFileSync(mainPath, "utf8");
    const utils = path.join(dir, "src/utils.ts");
    const helpers = path.join(dir, "src/helpers.ts");
    // Pre-populate scope.modified with mainPath so the scan skips it.
    const scope = makeScope(dir);
    scope.recordModified(mainPath);
    await p.afterFileRename(utils, helpers, scope);
    // File content unchanged — it was skipped by the scan.
    expect(fs.readFileSync(mainPath, "utf8")).toBe(originalContent);
  });

  it("afterFileRename records the modified file in scope.modified", async () => {
    const dir = setup();
    const p = new TsMorphCompiler();
    const utils = path.join(dir, "src/utils.ts");
    const helpers = path.join(dir, "src/helpers.ts");
    // Physically rename the file so the new path exists for the project refresh.
    fs.renameSync(utils, helpers);
    const scope = makeScope(dir);
    await p.afterFileRename(utils, helpers, scope);
    const mainPath = path.join(dir, "src/main.ts");
    expect(scope.modified).toContain(mainPath);
    expect(scope.modified.length).toBeGreaterThan(0);
    expect(scope.skipped).toEqual([]);
  });

  describe("symlink path resolution", () => {
    function setupSymlink() {
      const realDir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(realDir);
      const linkDir = `${realDir}-link`;
      fs.symlinkSync(realDir, linkDir, "dir");
      dirs.push(linkDir);
      return { realDir, linkDir };
    }

    it("resolveOffset works through a symlinked path", () => {
      const { linkDir } = setupSymlink();
      const p = new TsMorphCompiler();
      const file = path.join(linkDir, "src/utils.ts");
      expect(p.resolveOffset(file, 1, 17)).toBe(16);
    });

    it("getRenameLocations succeeds through a symlinked path", async () => {
      const { linkDir } = setupSymlink();
      const p = new TsMorphCompiler();
      const file = path.join(linkDir, "src/utils.ts");
      const offset = p.resolveOffset(file, 1, 17);
      const locs = await p.getRenameLocations(file, offset);
      expect(locs).not.toBeNull();
      expect(locs?.length).toBeGreaterThanOrEqual(2);
      // Response paths should be real (usable) paths
      for (const loc of locs!) {
        expect(fs.existsSync(loc.fileName)).toBe(true);
      }
    });

    it("getReferencesAtPosition succeeds through a symlinked path", async () => {
      const { linkDir } = setupSymlink();
      const p = new TsMorphCompiler();
      const file = path.join(linkDir, "src/utils.ts");
      const offset = p.resolveOffset(file, 1, 17);
      const refs = await p.getReferencesAtPosition(file, offset);
      expect(refs).not.toBeNull();
      expect(refs?.length).toBeGreaterThanOrEqual(1);
      for (const ref of refs!) {
        expect(fs.existsSync(ref.fileName)).toBe(true);
      }
    });

    it("getDefinitionAtPosition succeeds through a symlinked path", async () => {
      const { linkDir } = setupSymlink();
      const p = new TsMorphCompiler();
      const file = path.join(linkDir, "src/main.ts");
      const offset = p.resolveOffset(file, 3, 13); // greetUser call site
      const defs = await p.getDefinitionAtPosition(file, offset);
      expect(defs).not.toBeNull();
      expect(defs?.length).toBeGreaterThanOrEqual(1);
      expect(defs?.[0].name).toBe("greetUser");
      for (const def of defs!) {
        expect(fs.existsSync(def.fileName)).toBe(true);
      }
    });
  });

  it("getProjectForDirectory falls back to no-tsconfig project when no tsconfig found", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-notconfig-dir-"));
    try {
      const p = new TsMorphCompiler();
      // Must not throw — returns a bare Project without tsconfig.
      const project = p.getProjectForDirectory(tmpDir);
      expect(project).toBeTruthy();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
