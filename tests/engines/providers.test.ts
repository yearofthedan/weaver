import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TsProvider } from "../../src/engines/providers/ts.js";
import { VolarProvider } from "../../src/engines/providers/volar.js";
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
});
