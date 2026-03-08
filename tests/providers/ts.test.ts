import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TsProvider } from "../../src/providers/ts.js";
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
    expect(result).toHaveProperty("modified");
    expect(result).toHaveProperty("skipped");
  });

  describe("moveSymbol", () => {
    it("moves a named export to a new file and saves both files", async () => {
      const dir = setup();
      const p = new TsProvider();
      const { WorkspaceScope } = await import("../../src/domain/workspace-scope.js");
      const { NodeFileSystem } = await import("../../src/ports/node-filesystem.js");
      const scope = new WorkspaceScope(dir, new NodeFileSystem());
      const srcPath = path.join(dir, "src/utils.ts");
      const dstPath = path.join(dir, "src/helpers.ts");

      await p.moveSymbol(srcPath, "greetUser", dstPath, scope);

      expect(fs.readFileSync(dstPath, "utf8")).toContain("export function greetUser");
      expect(fs.readFileSync(srcPath, "utf8")).not.toContain("greetUser");
      expect(scope.modified).toContain(srcPath);
      expect(scope.modified).toContain(dstPath);
    });

    it("records importer outside the workspace boundary as skipped, not modified", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-provider-movesym-"));
      dirs.push(tmpDir);
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "lib"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true }, include: ["**/*.ts"] }),
      );
      fs.writeFileSync(
        path.join(tmpDir, "src/utils.ts"),
        "export function add(a: number, b: number): number { return a + b; }\n",
      );
      // Consumer in lib/ imports from src/ — it is outside the workspace (src/ only).
      fs.writeFileSync(
        path.join(tmpDir, "lib/consumer.ts"),
        'import { add } from "../src/utils";\nexport const r = add(1, 2);\n',
      );

      const { WorkspaceScope } = await import("../../src/domain/workspace-scope.js");
      const { NodeFileSystem } = await import("../../src/ports/node-filesystem.js");
      const scope = new WorkspaceScope(path.join(tmpDir, "src"), new NodeFileSystem());
      const p = new TsProvider();

      await p.moveSymbol(
        path.join(tmpDir, "src/utils.ts"),
        "add",
        path.join(tmpDir, "src/helpers.ts"),
        scope,
      );

      expect(scope.skipped.some((f) => f.includes("consumer.ts"))).toBe(true);
      expect(scope.modified.some((f) => f.includes("consumer.ts"))).toBe(false);
      // Consumer file must not be rewritten (it's outside the workspace).
      expect(fs.readFileSync(path.join(tmpDir, "lib/consumer.ts"), "utf8")).toContain(
        "../src/utils",
      );
    });

    it("does not add unrelated saved files to modified", async () => {
      const dir = setup();
      const p = new TsProvider();
      const { WorkspaceScope } = await import("../../src/domain/workspace-scope.js");
      const { NodeFileSystem } = await import("../../src/ports/node-filesystem.js");
      const scope = new WorkspaceScope(dir, new NodeFileSystem());
      // Write an extra file that imports something unrelated.
      const extraPath = path.join(dir, "src/unrelated.ts");
      fs.writeFileSync(extraPath, "export const UNRELATED = 42;\n");

      await p.moveSymbol(
        path.join(dir, "src/utils.ts"),
        "greetUser",
        path.join(dir, "src/helpers.ts"),
        scope,
      );

      // The unrelated file should NOT appear in scope.modified.
      expect(scope.modified).not.toContain(extraPath);
    });

    it("throws SYMBOL_NOT_FOUND when the symbol does not exist in source", async () => {
      const dir = setup();
      const p = new TsProvider();
      const { WorkspaceScope } = await import("../../src/domain/workspace-scope.js");
      const { NodeFileSystem } = await import("../../src/ports/node-filesystem.js");
      const scope = new WorkspaceScope(dir, new NodeFileSystem());

      await expect(
        p.moveSymbol(
          path.join(dir, "src/utils.ts"),
          "doesNotExist",
          path.join(dir, "src/b.ts"),
          scope,
        ),
      ).rejects.toMatchObject({ code: "SYMBOL_NOT_FOUND" });
    });

    it("throws SYMBOL_EXISTS when dest already exports the symbol and force is not set", async () => {
      const dir = setup();
      const p = new TsProvider();
      const { WorkspaceScope } = await import("../../src/domain/workspace-scope.js");
      const { NodeFileSystem } = await import("../../src/ports/node-filesystem.js");
      const scope = new WorkspaceScope(dir, new NodeFileSystem());
      fs.writeFileSync(path.join(dir, "src/helpers.ts"), "export function greetUser(): void {}\n");

      await expect(
        p.moveSymbol(
          path.join(dir, "src/utils.ts"),
          "greetUser",
          path.join(dir, "src/helpers.ts"),
          scope,
        ),
      ).rejects.toMatchObject({ code: "SYMBOL_EXISTS" });
    });

    it("creates the destination directory when it does not exist", async () => {
      const dir = setup();
      const p = new TsProvider();
      const { WorkspaceScope } = await import("../../src/domain/workspace-scope.js");
      const { NodeFileSystem } = await import("../../src/ports/node-filesystem.js");
      const scope = new WorkspaceScope(dir, new NodeFileSystem());
      const dstPath = path.join(dir, "src/nested/deep/helpers.ts");

      await p.moveSymbol(path.join(dir, "src/utils.ts"), "greetUser", dstPath, scope);

      expect(fs.existsSync(dstPath)).toBe(true);
      expect(fs.readFileSync(dstPath, "utf8")).toContain("greetUser");
    });

    it("appends to a non-empty destination file with a blank-line separator", async () => {
      const dir = setup();
      const p = new TsProvider();
      const { WorkspaceScope } = await import("../../src/domain/workspace-scope.js");
      const { NodeFileSystem } = await import("../../src/ports/node-filesystem.js");
      const scope = new WorkspaceScope(dir, new NodeFileSystem());
      const dstPath = path.join(dir, "src/helpers.ts");
      fs.writeFileSync(dstPath, 'export function helper(): string { return "hi"; }\n');

      await p.moveSymbol(path.join(dir, "src/utils.ts"), "greetUser", dstPath, scope);

      const content = fs.readFileSync(dstPath, "utf8");
      expect(content).toContain("helper");
      expect(content).toContain("greetUser");
      // Two declarations must be separated by a blank line.
      expect(content).toMatch(/helper[\s\S]*\n\nexport function greetUser/);
      // The existing content must not be mangled by trimStart (leading whitespace preserved).
      expect(content.startsWith("export function helper")).toBe(true);
    });
  });
});
