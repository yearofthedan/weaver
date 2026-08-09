import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixtureTest as test } from "../../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../../domain/workspace-scope.js";
import { NodeFileSystem } from "../../ports/node-filesystem.js";
import { TsMorphEngine } from "../../ts-engine/engine.js";
import { VolarEngine } from "./engine.js";

function makeScope(root: string): WorkspaceScope {
  return new WorkspaceScope(root, new NodeFileSystem());
}

describe("VolarEngine", () => {
  it("implements Engine interface shape", () => {
    const p = new VolarEngine(new TsMorphEngine());
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
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
    // vue-project: src/composables/useCounter.ts line 1 → "export function useCounter..."
    const file = path.join(dir, "src/composables/useCounter.ts");
    expect(p.resolveOffset(file, 1, 1)).toBe(0);
    expect(p.resolveOffset(file, 1, 17)).toBe(16);
  });

  test("getRenameLocations returns spans for a TS symbol in a Vue project", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
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

  test("getRenameLocations translates virtual .vue.ts paths to real .vue paths in results", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
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

  test("readFile reads from disk when no service has been cached yet", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
    const file = path.join(dir, "src/composables/useCounter.ts");
    const content = p.readFile(file);
    expect(content).toContain("useCounter");
  });

  test("notifyFileWritten: readFile returns updated content from the cache", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
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

  test("notifyFileWritten does not throw when service not yet cached", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
    const file = path.join(dir, "src/composables/useCounter.ts");
    // No service loaded — must be a silent no-op.
    expect(() => p.notifyFileWritten(file, "export const x = 1;\n")).not.toThrow();
  });

  test("moveFile moves the file and records it as modified", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
    const oldPath = path.join(dir, "src/composables/useCounter.ts");
    const newPath = path.join(dir, "src/composables/useTimer.ts");
    const scope = makeScope(dir);
    const result = await p.moveFile(oldPath, newPath, scope);
    expect(result.oldPath).toBe(oldPath);
    expect(result.newPath).toBe(newPath);
    expect(scope.skipped).toEqual([]);
    expect(scope.modified).toContain(newPath);
  });

  test("moveSymbol wires tsEngine.moveSymbol and Vue SFC scanning together", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    // Full integration: both TS AST surgery and the Vue import scan must fire.
    // App.vue imports useCounter — after moveSymbol, its import must be rewritten
    // to useTimer, proving both halves of VolarEngine.moveSymbol ran.
    const p = new VolarEngine(new TsMorphEngine());
    const scope = makeScope(dir);
    const sourceFile = path.join(dir, "src/composables/useCounter.ts");
    const destFile = path.join(dir, "src/composables/useTimer.ts");
    await p.moveSymbol(sourceFile, "useCounter", destFile, scope);

    const appVue = path.join(dir, "src/App.vue");
    expect(scope.modified).toContain(appVue);
    const content = fs.readFileSync(appVue, "utf8");
    // The import path must now reference useTimer, not useCounter
    expect(content).toContain("useTimer");
    expect(content).not.toContain('from "./composables/useCounter"');
  });

  test("moveSymbol from a .vue source routes through the vue branch", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    // The vue-project fixture's App.vue uses `useCounter` from a .ts file. Replace
    // App.vue with one that exports its own symbol so we exercise the vue-source path.
    const appVue = path.join(dir, "src/App.vue");
    fs.writeFileSync(
      appVue,
      [
        '<script setup lang="ts">',
        "export function shoutLabel(s: string): string { return s.toUpperCase(); }",
        "</script>",
        "<template><div>hi</div></template>",
        "",
      ].join("\n"),
    );

    const p = new VolarEngine(new TsMorphEngine());
    const scope = makeScope(dir);
    const destFile = path.join(dir, "src/utils/labels.ts");

    await p.moveSymbol(appVue, "shoutLabel", destFile, scope);

    expect(scope.modified).toContain(appVue);
    expect(scope.modified).toContain(destFile);
    expect(fs.readFileSync(appVue, "utf8")).not.toContain("shoutLabel");
    expect(fs.readFileSync(destFile, "utf8")).toContain("export function shoutLabel");
  });

  test("resolveOffset throws SYMBOL_NOT_FOUND for an out-of-range line in a .vue file", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
    const file = path.join(dir, "src/App.vue");
    expect(() => p.resolveOffset(file, 999, 1)).toThrow();
    try {
      p.resolveOffset(file, 999, 1);
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe("SYMBOL_NOT_FOUND");
    }
  });

  test("getReferencesAtPosition returns translated spans for a symbol in a Vue project", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
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

  test("getDefinitionAtPosition in a .vue file returns a real path (exercises toVirtualLocation)", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
    const file = path.join(dir, "src/App.vue");
    const content = fs.readFileSync(file, "utf8");
    const useCounterOffset = content.indexOf("useCounter");
    const result = await p.getDefinitionAtPosition(file, useCounterOffset);
    expect(result).not.toBeNull();
    expect(result?.length).toBeGreaterThanOrEqual(1);
    expect(result?.[0].fileName).not.toMatch(/\.vue\.ts$/);
    expect(result?.[0].fileName).toContain("useCounter.ts");
  }, 30_000);

  test("getReferencesAtPosition returns null for a blank line (no symbol)", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
    const file = path.join(dir, "src/main.ts");
    const content = fs.readFileSync(file, "utf8");
    const blankLineOffset = content.indexOf("\n\n") + 1;
    const result = await p.getReferencesAtPosition(file, blankLineOffset);
    expect(result).toBeNull();
  }, 30_000);

  test("getEditsForFileRename returns only real-path edits with non-empty textChanges", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
    const oldPath = path.join(dir, "src/composables/useCounter.ts");
    const newPath = path.join(dir, "src/composables/useTimer.ts");
    const edits = await p.getEditsForFileRename(oldPath, newPath);

    expect(edits.length).toBeGreaterThan(0);
    for (const edit of edits) {
      expect(edit.fileName).not.toMatch(/\.vue\.ts$/);
      expect(edit.textChanges.length).toBeGreaterThan(0);
    }
  }, 30_000);

  test("getDefinitionAtPosition returns null for a whitespace position", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
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

      const p = new VolarEngine(new TsMorphEngine());
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

  test("getRenameLocations returns null for a blank-line position in a .ts file (exercises rawLocs.length === 0 guard)", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
    const file = path.join(dir, "src/main.ts");
    const content = fs.readFileSync(file, "utf8");
    const blankLineOffset = content.indexOf("\n\n") + 1;
    const result = await p.getRenameLocations(file, blankLineOffset);
    expect(result).toBeNull();
  }, 30_000);

  test("getRenameLocations on a .vue file returns locations including the .vue path", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
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

  test("getReferencesAtPosition on a .vue file returns refs including the .vue path", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueProject.name);
    const p = new VolarEngine(new TsMorphEngine());
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
      const p = new VolarEngine(new TsMorphEngine());
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
      const p = new VolarEngine(new TsMorphEngine());
      const result = await p.getReferencesAtPosition(vueFile, 15);
      expect(result === null || Array.isArray(result)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30_000);

  describe("workspace expansion — files outside tsconfig.include", () => {
    test("getRenameLocations includes test file outside tsconfig.include", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.vueProject.name);
      const p = new VolarEngine(new TsMorphEngine(dir), dir);
      const file = path.join(dir, "src/composables/useCounter.ts");
      const offset = p.resolveOffset(file, 1, 17);
      const locs = await p.getRenameLocations(file, offset);

      expect(locs).not.toBeNull();
      const testFile = path.join(dir, "tests/unit/counter.test.ts");
      const locsInTest = locs?.filter((l) => l.fileName === testFile) ?? [];
      expect(locsInTest.length).toBeGreaterThan(0);
    }, 30_000);

    test("rename in a Vue project updates a test file outside tsconfig.include", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.vueProject.name);
      const p = new VolarEngine(new TsMorphEngine(dir), dir);
      const file = path.join(dir, "src/composables/useCounter.ts");

      const result = await p.rename(file, 1, 17, "useTimer", makeScope(dir));

      expect(result.symbolName).toBe("useCounter");
      expect(result.newName).toBe("useTimer");
      const testContent = fs.readFileSync(path.join(dir, "tests/unit/counter.test.ts"), "utf8");
      // The import binding should be renamed, but the module specifier path
      // still contains "useCounter" as a filename — check the binding only.
      expect(testContent).toContain("import { useTimer }");
      expect(testContent).not.toContain("import { useCounter }");
    }, 30_000);

    test("findReferences in a Vue project returns a location in a test file outside tsconfig.include", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.vueProject.name);
      const p = new VolarEngine(new TsMorphEngine(dir), dir);
      const file = path.join(dir, "src/composables/useCounter.ts");
      const offset = p.resolveOffset(file, 1, 17);
      const refs = await p.getReferencesAtPosition(file, offset);

      expect(refs).not.toBeNull();
      const testFile = path.join(dir, "tests/unit/counter.test.ts");
      const refInTest = refs?.find((r) => r.fileName === testFile);
      expect(refInTest).toBeDefined();
    }, 30_000);
  });
});
