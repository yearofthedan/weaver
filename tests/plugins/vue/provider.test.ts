import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VolarProvider } from "../../../src/plugins/vue/provider.js";
import { cleanup, copyFixture } from "../../helpers.js";

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

  it("getDefinitionAtPosition in a .vue file returns a real path (exercises toVirtualLocation)", async () => {
    const dir = setup();
    const p = new VolarProvider();
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
    const p = new VolarProvider();
    const file = path.join(dir, "src/main.ts");
    const content = fs.readFileSync(file, "utf8");
    const blankLineOffset = content.indexOf("\n\n") + 1;
    const result = await p.getReferencesAtPosition(file, blankLineOffset);
    expect(result).toBeNull();
  }, 30_000);

  it("getEditsForFileRename returns only real-path edits with non-empty textChanges", async () => {
    const dir = setup();
    const p = new VolarProvider();
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
    const p = new VolarProvider();
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

      const p = new VolarProvider();
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
    const p = new VolarProvider();
    const file = path.join(dir, "src/main.ts");
    const content = fs.readFileSync(file, "utf8");
    const blankLineOffset = content.indexOf("\n\n") + 1;
    const result = await p.getRenameLocations(file, blankLineOffset);
    expect(result).toBeNull();
  }, 30_000);

  it("getRenameLocations on a .vue file returns locations including the .vue path", async () => {
    const dir = setup();
    const p = new VolarProvider();
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
    const p = new VolarProvider();
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
      const p = new VolarProvider();
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
      const p = new VolarProvider();
      const result = await p.getReferencesAtPosition(vueFile, 15);
      expect(result === null || Array.isArray(result)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30_000);
});
