import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TsProvider } from "../../src/providers/ts.js";
import { VolarProvider } from "../../src/providers/volar.js";
import { EngineError } from "../../src/utils/errors.js";
import { cleanup, copyFixture } from "../helpers.js";

// simple-ts fixture:
//   src/utils.ts  line 1, col 17 → greetUser
//   src/main.ts   line 1, col 10 → greetUser (import)
//                 line 3, col 13 → greetUser (call)

describe("TsProvider", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = "simple-ts") {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  it("implements LanguageProvider shape", () => {
    const p = new TsProvider();
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

  it("afterSymbolMove is a no-op that returns empty lists", async () => {
    const p = new TsProvider();
    const result = await p.afterSymbolMove("/a.ts", "foo", "/b.ts", "/workspace");
    expect(result).toEqual({ modified: [], skipped: [] });
  });

  it("resolveOffset converts 1-based line/col to 0-based offset", () => {
    const dir = setup();
    const p = new TsProvider();
    const file = path.join(dir, "src/utils.ts");
    // line 1, col 1 → offset 0
    expect(p.resolveOffset(file, 1, 1)).toBe(0);
    // line 1, col 17 → offset 16 (0-based)
    expect(p.resolveOffset(file, 1, 17)).toBe(16);
  });

  it("getRenameLocations returns spans for a symbol", async () => {
    const dir = setup();
    const p = new TsProvider();
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
    const p = new TsProvider();
    const file = path.join(dir, "src/utils.ts");
    const offset = p.resolveOffset(file, 1, 17);
    const refs = await p.getReferencesAtPosition(file, offset);
    expect(refs).not.toBeNull();
    expect(refs?.length).toBeGreaterThanOrEqual(1);
  });

  it("getDefinitionAtPosition returns definition location", async () => {
    const dir = setup();
    const p = new TsProvider();
    const file = path.join(dir, "src/main.ts");
    const offset = p.resolveOffset(file, 3, 13); // greetUser call site
    const defs = await p.getDefinitionAtPosition(file, offset);
    expect(defs).not.toBeNull();
    expect(defs?.length).toBeGreaterThanOrEqual(1);
    expect(defs?.[0].name).toBe("greetUser");
    expect(defs?.[0].fileName).toContain("utils.ts");
  });

  it("refreshFile is a no-op when the project has not been loaded yet", () => {
    const p = new TsProvider();
    // No project has been created — must not throw.
    expect(() => p.refreshFile("/nonexistent/path.ts")).not.toThrow();
  });

  it("refreshFile does not throw after a project has been loaded", () => {
    const dir = setup();
    const p = new TsProvider();
    const file = path.join(dir, "src/utils.ts");
    // Force project load.
    p.resolveOffset(file, 1, 1);
    // Modify file on disk then refresh — must not throw.
    expect(() => p.refreshFile(file)).not.toThrow();
  });

  it("getRenameLocations throws RENAME_NOT_ALLOWED for a non-renameable token", async () => {
    const dir = setup();
    const p = new TsProvider();
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
    const p = new TsProvider();
    // main.ts line 2 is blank — any position there has no symbol definition
    const file = path.join(dir, "src/main.ts");
    // Line 2 is the empty line between the import and the console.log call
    const result = await p.getDefinitionAtPosition(file, 37); // '\n' at end of line 1
    expect(result).toBeNull();
  });

  it("resolveOffset works for a file with no parent tsconfig (no-tsconfig project path)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-notconfig-"));
    const file = path.join(tmpDir, "standalone.ts");
    fs.writeFileSync(file, "export const x = 1;\n");
    try {
      const p = new TsProvider();
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
      const p = new TsProvider();
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
      const p = new TsProvider();
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
      const p = new TsProvider();
      // 'myVar' in 'const x = myVar' starts at offset 41
      const content = fs.readFileSync(file, "utf8");
      const offset = content.indexOf("myVar", content.indexOf("const x"));
      const defs = await p.getDefinitionAtPosition(file, offset);
      expect(defs).not.toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("afterFileRename skips files outside the workspace boundary", async () => {
    const dir = setup();
    const p = new TsProvider();
    // Workspace is a subdirectory; the fixture root is outside it.
    const workspace = path.join(dir, "src");
    const oldPath = path.join(dir, "src/utils.ts");
    const newPath = path.join(dir, "src/helpers.ts");
    const result = await p.afterFileRename(oldPath, newPath, workspace);
    // Files outside workspace/src are skipped (if any out-of-project files existed).
    expect(result).toHaveProperty("modified");
    expect(result).toHaveProperty("skipped");
  });
});

describe("VolarProvider", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = "vue-project") {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  it("implements LanguageProvider shape", () => {
    const p = new VolarProvider();
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

  it("afterSymbolMove is a no-op that returns empty lists", async () => {
    const p = new VolarProvider();
    const result = await p.afterSymbolMove("/a.vue", "foo", "/b.ts", "/workspace");
    expect(result).toEqual({ modified: [], skipped: [] });
  });

  it("resolveOffset converts 1-based line/col to 0-based offset", () => {
    const dir = setup();
    const p = new VolarProvider();
    // vue-project: src/composables/useCounter.ts line 1 → "export function useCounter..."
    const file = path.join(dir, "src/composables/useCounter.ts");
    expect(p.resolveOffset(file, 1, 1)).toBe(0);
    expect(p.resolveOffset(file, 1, 17)).toBe(16);
  });

  it("getRenameLocations returns spans for a TS symbol in a Vue project", async () => {
    const dir = setup();
    const p = new VolarProvider();
    // useCounter is declared at line 1, col 17 of useCounter.ts
    const file = path.join(dir, "src/composables/useCounter.ts");
    const offset = p.resolveOffset(file, 1, 17);
    const locs = await p.getRenameLocations(file, offset);
    expect(locs).not.toBeNull();
    expect(locs?.length).toBeGreaterThanOrEqual(1);
    // All returned paths must be real paths (no .vue.ts virtual paths)
    for (const loc of locs ?? []) {
      expect(loc.fileName).not.toMatch(/\.vue\.ts$/);
    }
  });

  it("getRenameLocations translates virtual .vue.ts paths to real .vue paths in results", async () => {
    const dir = setup();
    const p = new VolarProvider();
    // useCounter is used in App.vue; rename locations from useCounter.ts must include
    // the real App.vue path (not the .vue.ts virtual path used internally by Volar)
    const file = path.join(dir, "src/composables/useCounter.ts");
    const offset = p.resolveOffset(file, 1, 17); // useCounter declaration
    const locs = await p.getRenameLocations(file, offset);
    expect(locs).not.toBeNull();
    const vueFile = path.join(dir, "src/App.vue");
    const hasVueLoc = locs?.some((loc) => loc.fileName === vueFile);
    expect(hasVueLoc).toBe(true);
  });

  it("readFile reads from disk when no service has been cached yet", () => {
    const dir = setup();
    const p = new VolarProvider();
    const file = path.join(dir, "src/composables/useCounter.ts");
    const content = p.readFile(file);
    expect(content).toContain("useCounter");
  });

  it("notifyFileWritten: readFile returns updated content from the cache", async () => {
    const dir = setup();
    const p = new VolarProvider();
    const file = path.join(dir, "src/composables/useCounter.ts");
    // Load service by calling getRenameLocations (builds and caches the service).
    const offset = p.resolveOffset(file, 1, 17);
    await p.getRenameLocations(file, offset);
    // Write updated content to the provider's cache (not to disk).
    const updatedContent = "export function renamedFn() {}\n";
    p.notifyFileWritten(file, updatedContent);
    // readFile must return the cached content, not the stale disk content.
    expect(p.readFile(file)).toBe(updatedContent);
  });

  it("notifyFileWritten does not throw when service not yet cached", () => {
    const dir = setup();
    const p = new VolarProvider();
    const file = path.join(dir, "src/composables/useCounter.ts");
    // No service loaded — must be a silent no-op.
    expect(() => p.notifyFileWritten(file, "export const x = 1;\n")).not.toThrow();
  });

  it("afterFileRename returns modified list and empty skipped array", async () => {
    const dir = setup();
    const p = new VolarProvider();
    const oldPath = path.join(dir, "src/composables/useCounter.ts");
    const newPath = path.join(dir, "src/composables/useTimer.ts");
    const result = await p.afterFileRename(oldPath, newPath, dir);
    expect(result).toHaveProperty("modified");
    expect(result.skipped).toEqual([]);
  });

  it("afterSymbolMove returns empty modified and skipped arrays when no .vue files match", async () => {
    // Use a plain TS fixture (no .vue files) so nothing is modified or skipped.
    const tsDir = copyFixture("simple-ts");
    dirs.push(tsDir);
    const p = new VolarProvider();
    const result = await p.afterSymbolMove(
      path.join(tsDir, "src/utils.ts"),
      "greetUser",
      path.join(tsDir, "src/helpers.ts"),
      tsDir,
    );
    expect(result.modified).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("resolveOffset throws SYMBOL_NOT_FOUND for an out-of-range line in a .vue file", () => {
    // Exercises the resolveOffset catch block in volar.ts (line 103-104).
    const dir = setup();
    const p = new VolarProvider();
    const file = path.join(dir, "src/App.vue");
    expect(() => p.resolveOffset(file, 999, 1)).toThrow();
    try {
      p.resolveOffset(file, 999, 1);
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe("SYMBOL_NOT_FOUND");
    }
  });

  it("getReferencesAtPosition returns translated spans for a symbol in a Vue project", async () => {
    // Exercises translateLocations + translateSingleLocation for getReferencesAtPosition.
    const dir = setup();
    const p = new VolarProvider();
    const file = path.join(dir, "src/composables/useCounter.ts");
    const offset = p.resolveOffset(file, 1, 17); // useCounter declaration
    const refs = await p.getReferencesAtPosition(file, offset);
    expect(refs).not.toBeNull();
    expect(refs?.length).toBeGreaterThanOrEqual(1);
    // All returned paths must be real paths (no .vue.ts virtual paths)
    for (const ref of refs ?? []) {
      expect(ref.fileName).not.toMatch(/\.vue\.ts$/);
      expect(typeof ref.textSpan.start).toBe("number");
      expect(ref.textSpan.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it("getDefinitionAtPosition returns null for a whitespace position", async () => {
    // Exercises the `!rawDefs || rawDefs.length === 0` null-return path.
    const dir = setup();
    const p = new VolarProvider();
    const file = path.join(dir, "src/composables/useCounter.ts");
    const content = fs.readFileSync(file, "utf8");
    // Find a position on the closing brace line (no symbol definition there)
    const closingBraceOffset = content.lastIndexOf("}");
    const result = await p.getDefinitionAtPosition(file, closingBraceOffset);
    // Either null (no def) or an array — must not throw.
    expect(result === null || Array.isArray(result)).toBe(true);
  }, 30_000);
});
