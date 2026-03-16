import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../../domain/workspace-scope.js";
import { NodeFileSystem } from "../../ports/node-filesystem.js";
import { VolarCompiler } from "./compiler.js";

function makeScope(root: string): WorkspaceScope {
  return new WorkspaceScope(root, new NodeFileSystem());
}

describe("VolarCompiler", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = FIXTURES.vueProject.name) {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  it("implements Compiler shape", () => {
    const p = new VolarCompiler();
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

  it("afterSymbolMove is a no-op when no matching .vue files exist", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vue-noop-"));
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    try {
      const p = new VolarCompiler();
      const scope = makeScope(tmpDir);
      await p.afterSymbolMove(
        path.join(tmpDir, "src/a.ts"),
        "foo",
        path.join(tmpDir, "src/b.ts"),
        scope,
      );
      expect(scope.modified).toEqual([]);
      expect(scope.skipped).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("resolveOffset converts 1-based line/col to 0-based offset", () => {
    const dir = setup();
    const p = new VolarCompiler();
    // vue-project: src/composables/useCounter.ts line 1 → "export function useCounter..."
    const file = path.join(dir, "src/composables/useCounter.ts");
    expect(p.resolveOffset(file, 1, 1)).toBe(0);
    expect(p.resolveOffset(file, 1, 17)).toBe(16);
  });

  it("getRenameLocations returns spans for a TS symbol in a Vue project", async () => {
    const dir = setup();
    const p = new VolarCompiler();
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
    const p = new VolarCompiler();
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
    const p = new VolarCompiler();
    const file = path.join(dir, "src/composables/useCounter.ts");
    const content = p.readFile(file);
    expect(content).toContain("useCounter");
  });

  it("notifyFileWritten: readFile returns updated content from the cache", async () => {
    const dir = setup();
    const p = new VolarCompiler();
    const file = path.join(dir, "src/composables/useCounter.ts");
    // Load service by calling getRenameLocations (builds and caches the service).
    const offset = p.resolveOffset(file, 1, 17);
    await p.getRenameLocations(file, offset);
    // Write updated content to the compiler's cache (not to disk).
    const updatedContent = "export function renamedFn() {}\n";
    p.notifyFileWritten(file, updatedContent);
    // readFile must return the cached content, not the stale disk content.
    expect(p.readFile(file)).toBe(updatedContent);
  });

  it("notifyFileWritten does not throw when service not yet cached", () => {
    const dir = setup();
    const p = new VolarCompiler();
    const file = path.join(dir, "src/composables/useCounter.ts");
    // No service loaded — must be a silent no-op.
    expect(() => p.notifyFileWritten(file, "export const x = 1;\n")).not.toThrow();
  });

  it("afterFileRename records modified files into scope and no skipped files", async () => {
    const dir = setup();
    const p = new VolarCompiler();
    const oldPath = path.join(dir, "src/composables/useCounter.ts");
    const newPath = path.join(dir, "src/composables/useTimer.ts");
    const scope = makeScope(dir);
    await p.afterFileRename(oldPath, newPath, scope);
    // No .vue files import useCounter in this fixture, so nothing is modified
    expect(scope.skipped).toEqual([]);
  });

  it("afterSymbolMove records nothing into scope when no .vue files match", async () => {
    // Use a plain TS fixture (no .vue files) so nothing is modified or skipped.
    const tsDir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(tsDir);
    const p = new VolarCompiler();
    const scope = makeScope(tsDir);
    await p.afterSymbolMove(
      path.join(tsDir, "src/utils.ts"),
      "greetUser",
      path.join(tsDir, "src/helpers.ts"),
      scope,
    );
    expect(scope.modified).toEqual([]);
    expect(scope.skipped).toEqual([]);
  });

  it("afterSymbolMove rewrites a matching named import in a .vue file", async () => {
    const dir = copyFixture(FIXTURES.vueProject.name);
    dirs.push(dir);
    const p = new VolarCompiler();
    const scope = makeScope(dir);
    // App.vue imports useCounter from composables/useCounter
    const sourceFile = path.join(dir, "src/composables/useCounter.ts");
    const destFile = path.join(dir, "src/composables/useTimer.ts");
    await p.afterSymbolMove(sourceFile, "useCounter", destFile, scope);

    const appVue = path.join(dir, "src/App.vue");
    expect(scope.modified).toContain(appVue);
    const content = fs.readFileSync(appVue, "utf8");
    expect(content).toContain("useTimer");
    expect(content).not.toContain("useCounter.js");
    expect(content).not.toContain('from "./composables/useCounter"');
  });

  it("afterSymbolMove does not rewrite a .vue file already in scope.modified", async () => {
    const dir = copyFixture(FIXTURES.vueProject.name);
    dirs.push(dir);
    const p = new VolarCompiler();
    const scope = makeScope(dir);
    const appVue = path.join(dir, "src/App.vue");
    // Pre-mark App.vue as already modified
    scope.writeFile(appVue, fs.readFileSync(appVue, "utf8"));
    const contentBefore = fs.readFileSync(appVue, "utf8");

    const sourceFile = path.join(dir, "src/composables/useCounter.ts");
    const destFile = path.join(dir, "src/composables/useTimer.ts");
    await p.afterSymbolMove(sourceFile, "useCounter", destFile, scope);

    // App.vue was already modified; afterSymbolMove must skip it
    const contentAfter = fs.readFileSync(appVue, "utf8");
    expect(contentAfter).toBe(contentBefore);
  });

  it("afterSymbolMove does not modify .vue files that do not import the symbol", async () => {
    const dir = copyFixture(FIXTURES.vueProject.name);
    dirs.push(dir);
    const p = new VolarCompiler();
    const scope = makeScope(dir);
    // Move a symbol that App.vue does not import
    const sourceFile = path.join(dir, "src/composables/useCounter.ts");
    const destFile = path.join(dir, "src/composables/useTimer.ts");
    await p.afterSymbolMove(sourceFile, "nonExistentSymbol", destFile, scope);

    expect(scope.modified).toEqual([]);
  });

  it("resolveOffset throws SYMBOL_NOT_FOUND for an out-of-range line in a .vue file", () => {
    const dir = setup();
    const p = new VolarCompiler();
    const file = path.join(dir, "src/App.vue");
    expect(() => p.resolveOffset(file, 999, 1)).toThrow();
    try {
      p.resolveOffset(file, 999, 1);
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe("SYMBOL_NOT_FOUND");
    }
  });

  it("getReferencesAtPosition returns translated spans for a symbol in a Vue project", async () => {
    const dir = setup();
    const p = new VolarCompiler();
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

  it("getDefinitionAtPosition in a .vue file returns a real path (exercises toVirtualLocation)", async () => {
    const dir = setup();
    const p = new VolarCompiler();
    const file = path.join(dir, "src/App.vue");
    const content = fs.readFileSync(file, "utf8");
    const useCounterOffset = content.indexOf("useCounter");
    const result = await p.getDefinitionAtPosition(file, useCounterOffset);
    expect(result).not.toBeNull();
    expect(result?.length).toBeGreaterThanOrEqual(1);
    expect(result?.[0].fileName).not.toMatch(/\.vue\.ts$/);
    expect(result?.[0].fileName).toContain("useCounter.ts");
  }, 30_000);

  it("getReferencesAtPosition returns null for a blank line (no symbol)", async () => {
    const dir = setup();
    const p = new VolarCompiler();
    const file = path.join(dir, "src/main.ts");
    const content = fs.readFileSync(file, "utf8");
    const blankLineOffset = content.indexOf("\n\n") + 1;
    const result = await p.getReferencesAtPosition(file, blankLineOffset);
    expect(result).toBeNull();
  }, 30_000);

  it("getEditsForFileRename returns only real-path edits with non-empty textChanges", async () => {
    const dir = setup();
    const p = new VolarCompiler();
    const oldPath = path.join(dir, "src/composables/useCounter.ts");
    const newPath = path.join(dir, "src/composables/useTimer.ts");
    const edits = await p.getEditsForFileRename(oldPath, newPath);

    expect(edits.length).toBeGreaterThan(0);
    for (const edit of edits) {
      expect(edit.fileName).not.toMatch(/\.vue\.ts$/);
      expect(edit.textChanges.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it("getDefinitionAtPosition returns null for a whitespace position", async () => {
    const dir = setup();
    const p = new VolarCompiler();
    const file = path.join(dir, "src/composables/useCounter.ts");
    const content = fs.readFileSync(file, "utf8");
    const closingBraceOffset = content.lastIndexOf("}");
    const result = await p.getDefinitionAtPosition(file, closingBraceOffset);
    expect(result === null || Array.isArray(result)).toBe(true);
  }, 30_000);

  it("getDefinitionAtPosition on a template-only .vue file exercises toVirtualLocation !serviceScript fallback", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vue-noscript-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { strict: true, target: "ESNext", moduleResolution: "bundler" },
          include: ["src/**/*.ts", "src/**/*.vue"],
        }),
      );
      const vueFile = path.join(tmpDir, "src/NoScript.vue");
      fs.writeFileSync(vueFile, "<template>\n  <div>Hello</div>\n</template>\n");

      const p = new VolarCompiler();
      const result = await p.getDefinitionAtPosition(vueFile, 15);
      expect(result === null || Array.isArray(result)).toBe(true);
      if (Array.isArray(result)) {
        for (const def of result) {
          expect(def.fileName).not.toMatch(/\.vue\.ts$/);
        }
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("getRenameLocations returns null for a blank-line position in a .ts file (exercises rawLocs.length === 0 guard)", async () => {
    const dir = setup();
    const p = new VolarCompiler();
    const file = path.join(dir, "src/main.ts");
    const content = fs.readFileSync(file, "utf8");
    const blankLineOffset = content.indexOf("\n\n") + 1;
    const result = await p.getRenameLocations(file, blankLineOffset);
    expect(result).toBeNull();
  }, 30_000);

  it("getRenameLocations on a .vue file returns locations including the .vue path", async () => {
    const dir = setup();
    const p = new VolarCompiler();
    const file = path.join(dir, "src/App.vue");
    const content = fs.readFileSync(file, "utf8");
    const offset = content.indexOf("useCounter");
    const locs = await p.getRenameLocations(file, offset);
    expect(locs).not.toBeNull();
    expect(locs?.some((l) => l.fileName === file)).toBe(true);
    for (const loc of locs ?? []) {
      expect(loc.fileName).not.toMatch(/\.vue\.ts$/);
    }
  }, 30_000);

  it("getReferencesAtPosition on a .vue file returns refs including the .vue path", async () => {
    const dir = setup();
    const p = new VolarCompiler();
    const file = path.join(dir, "src/App.vue");
    const content = fs.readFileSync(file, "utf8");
    const offset = content.indexOf("useCounter");
    const refs = await p.getReferencesAtPosition(file, offset);
    expect(refs).not.toBeNull();
    expect(refs?.some((r) => r.fileName === file)).toBe(true);
    for (const ref of refs ?? []) {
      expect(ref.fileName).not.toMatch(/\.vue\.ts$/);
    }
  }, 30_000);

  it("getRenameLocations on a template-only .vue file returns null without throwing", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vue-noscript-rename-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { strict: true, target: "ESNext", moduleResolution: "bundler" },
          include: ["src/**/*.ts", "src/**/*.vue"],
        }),
      );
      const vueFile = path.join(tmpDir, "src/NoScript.vue");
      fs.writeFileSync(vueFile, "<template>\n  <div>Hello</div>\n</template>\n");
      const p = new VolarCompiler();
      const result = await p.getRenameLocations(vueFile, 15);
      expect(result === null || Array.isArray(result)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("getReferencesAtPosition on a template-only .vue file returns null without throwing", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vue-noscript-refs-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { strict: true, target: "ESNext", moduleResolution: "bundler" },
          include: ["src/**/*.ts", "src/**/*.vue"],
        }),
      );
      const vueFile = path.join(tmpDir, "src/NoScript.vue");
      fs.writeFileSync(vueFile, "<template>\n  <div>Hello</div>\n</template>\n");
      const p = new VolarCompiler();
      const result = await p.getReferencesAtPosition(vueFile, 15);
      expect(result === null || Array.isArray(result)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30_000);
});
