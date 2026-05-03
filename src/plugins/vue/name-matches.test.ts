import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "../../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../../domain/workspace-scope.js";
import { NodeFileSystem } from "../../ports/node-filesystem.js";
import { TsMorphEngine } from "../../ts-engine/engine.js";
import { VolarEngine } from "./engine.js";
import { blockOffsetToFilePosition, scanVueNameMatches } from "./name-matches.js";

describe("blockOffsetToFilePosition", () => {
  it("translates a block-relative offset to 1-based line/col in the full file", () => {
    // Line 1: <template><div/></template>\n  (32 chars)
    // Line 2: <script setup>\n              (15 chars, blockStart = 32)
    // Line 3: const x = 1;\n               (identifier 'x' is at offset 6 within block)
    const fileContent = "<template><div/></template>\n<script setup>\nconst x = 1;\n</script>\n";
    const blockStart = fileContent.indexOf("\nconst") + 1; // start of line 3
    const identOffset = 6; // 'x' within "const x = 1;"

    const result = blockOffsetToFilePosition(fileContent, blockStart, identOffset);

    expect(result.line).toBe(3);
    expect(result.col).toBe(7);
  });

  it("returns line 1 col 1 for offset 0 at file start", () => {
    const result = blockOffsetToFilePosition("abc", 0, 0);
    expect(result.line).toBe(1);
    expect(result.col).toBe(1);
  });
});

describe("scanVueNameMatches", () => {
  describe("scanning .ts files", () => {
    it("finds derivative identifiers containing the old name as a substring", () => {
      const content =
        "export function useCounter() {}\nexport const useCounterHelper = useCounter;\n";
      const oldContents = new Map([["src/useCounter.ts", content]]);

      const matches = scanVueNameMatches("useCounter", oldContents, []);

      expect(matches.map((m) => m.name)).toContain("useCounterHelper");
    });

    it("excludes positions that were directly renamed", () => {
      // Simulates: useCounter renamed to useCounterValue; exclude the call site
      const content =
        "export function useCounter() {}\nexport const useCounterHelper = useCounter();\n";
      // offset of 'useCounter' declaration: 16
      const offset = content.indexOf("useCounter");
      const oldContents = new Map([["src/useCounter.ts", content]]);
      const excludePositions = [{ file: "src/useCounter.ts", offset }];

      const matches = scanVueNameMatches("useCounter", oldContents, excludePositions);

      // The declaration 'useCounter' is excluded; useCounterHelper and the call are not
      expect(matches.some((m) => m.name === "useCounter" && m.col === offset + 1)).toBe(false);
      expect(matches.some((m) => m.name === "useCounterHelper")).toBe(true);
    });

    it("returns name, file, 1-based line/col, and kind for each match", () => {
      const content = "const useCounterHelper = 1;\n";
      const oldContents = new Map([["src/helpers.ts", content]]);

      const matches = scanVueNameMatches("useCounter", oldContents, []);

      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        file: "src/helpers.ts",
        name: "useCounterHelper",
        line: 1,
        col: 7,
        kind: expect.any(String),
      });
    });

    it("returns [] when no derivatives exist", () => {
      const content = "export function other() {}\n";
      const oldContents = new Map([["src/other.ts", content]]);

      expect(scanVueNameMatches("useCounter", oldContents, [])).toEqual([]);
    });
  });

  describe("scanning .vue files", () => {
    it("finds derivatives in a <script setup> block and reports real file coordinates", () => {
      // <template> comes first so script block is NOT at line 1 — proves coordinate translation
      const vueContent = [
        "<template><div>hello</div></template>",
        '<script setup lang="ts">',
        "const useCounterRef = 1;",
        "</script>",
      ].join("\n");
      const oldContents = new Map([["src/App.vue", vueContent]]);

      const matches = scanVueNameMatches("useCounter", oldContents, []);

      expect(matches).toHaveLength(1);
      const m = matches[0];
      expect(m.file).toBe("src/App.vue");
      expect(m.name).toBe("useCounterRef");
      expect(m.line).toBe(3); // line 3 in the full .vue file
      expect(m.col).toBe(7); // col 7: "const |useCounterRef"
      expect(m.kind).toBeTruthy();
    });

    it("scans both <script> and <script setup> blocks when both are present", () => {
      const vueContent = [
        "<script>",
        "const useCounterA = 1;",
        "</script>",
        "<script setup>",
        "const useCounterB = 2;",
        "</script>",
        "<template><div/></template>",
      ].join("\n");
      const oldContents = new Map([["src/Both.vue", vueContent]]);

      const matches = scanVueNameMatches("useCounter", oldContents, []);

      expect(matches.map((m) => m.name)).toContain("useCounterA");
      expect(matches.map((m) => m.name)).toContain("useCounterB");
    });

    it("returns [] for a template-only .vue file", () => {
      const vueContent = "<template><div>hello</div></template>\n";
      const oldContents = new Map([["src/NoScript.vue", vueContent]]);

      expect(scanVueNameMatches("useCounter", oldContents, [])).toEqual([]);
    });

    it("does not scan template expressions — only script blocks", () => {
      // Template mustache {{ useCounterValue }} looks like an identifier to a plain TS parser.
      // scanVueFile must restrict to script blocks only; scanTsFile on the full content would
      // find useCounterValue and produce a false match.
      const vueContent = [
        "<template>{{ useCounterValue }}</template>",
        "<script setup>",
        "const useCounterRef = 1;",
        "</script>",
      ].join("\n");
      const oldContents = new Map([["src/App.vue", vueContent]]);

      const matches = scanVueNameMatches("useCounter", oldContents, []);

      expect(matches.every((m) => m.name !== "useCounterValue")).toBe(true);
      expect(matches.some((m) => m.name === "useCounterRef")).toBe(true);
    });

    it("excludes identifiers that do not contain oldName", () => {
      const vueContent = [
        "<template><div/></template>",
        "<script setup>",
        "const useCounterRef = 1;",
        "const unrelated = 2;",
        "</script>",
      ].join("\n");
      const oldContents = new Map([["src/App.vue", vueContent]]);

      const matches = scanVueNameMatches("useCounter", oldContents, []);

      expect(matches.every((m) => m.name !== "unrelated")).toBe(true);
      expect(matches.some((m) => m.name === "useCounterRef")).toBe(true);
    });

    it("excludes positions that were directly renamed in .vue files", () => {
      // <template/>\n = 12 chars; <script>\n = 9 chars; "const " = 6 chars
      // → useCounterRef starts at blockStart(12) + identOffset(15) = realOffset(27)
      const vueContent = [
        "<template/>",
        "<script>",
        "const useCounterRef = 1;",
        "const useCounterB = 2;",
        "</script>",
      ].join("\n");
      const excludePositions = [{ file: "src/App.vue", offset: 27 }];
      const oldContents = new Map([["src/App.vue", vueContent]]);

      const matches = scanVueNameMatches("useCounter", oldContents, excludePositions);

      expect(matches.some((m) => m.name === "useCounterRef")).toBe(false);
      expect(matches.some((m) => m.name === "useCounterB")).toBe(true);
    });
  });
});

describe("VolarEngine.rename nameMatches — integration", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  async function setupVueProject(extraFiles: Record<string, string> = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vue-namematches-"));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "src/composables"), { recursive: true });

    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
        },
        include: ["src/**/*.ts", "src/**/*.vue"],
      }),
    );

    // useCounter.ts with a derivative identifier
    fs.writeFileSync(
      path.join(dir, "src/composables/useCounter.ts"),
      [
        "export function useCounter(initial = 0) {",
        "  return { count: () => initial };",
        "}",
        "export const useCounterHelper = useCounter;",
      ].join("\n"),
    );

    for (const [rel, content] of Object.entries(extraFiles)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }

    return dir;
  }

  it("returns nameMatches for renamed .ts files, excluding renamed sites even when newName contains oldName", async () => {
    const dir = await setupVueProject();
    const engine = new VolarEngine(new TsMorphEngine(dir), dir);
    const scope = new WorkspaceScope(dir, new NodeFileSystem());

    // newName "useCounterValue" contains oldName "useCounter" as a substring —
    // proves excludePositions prevents the renamed sites from appearing
    const result = await engine.rename(
      path.join(dir, "src/composables/useCounter.ts"),
      1,
      17,
      "useCounterValue",
      scope,
    );

    expect(Array.isArray(result.nameMatches)).toBe(true);
    expect(result.nameMatches.some((m) => m.name === "useCounterHelper")).toBe(true);
    // The renamed function declaration and call sites must not appear
    expect(result.nameMatches.every((m) => m.name !== "useCounter")).toBe(true);
  }, 30_000);

  it("returns nameMatches for renamed .vue files with real file coordinates", async () => {
    // <template> first — so the script block starts at line 2+, proving
    // that returned coordinates are real file positions, not block-relative
    const appVue = [
      "<template><div>hello</div></template>",
      '<script setup lang="ts">',
      'import { useCounter } from "./composables/useCounter";',
      "const useCounterRef = useCounter(0);",
      "</script>",
    ].join("\n");

    const dir = await setupVueProject({ "src/App.vue": appVue });
    const engine = new VolarEngine(new TsMorphEngine(dir), dir);
    const scope = new WorkspaceScope(dir, new NodeFileSystem());

    const result = await engine.rename(
      path.join(dir, "src/composables/useCounter.ts"),
      1,
      17,
      "useTimer",
      scope,
    );

    const vueMatch = result.nameMatches.find((m) => m.name === "useCounterRef");
    expect(vueMatch).toBeDefined();
    expect(vueMatch?.file).toContain("App.vue");
    // useCounterRef is on line 4 of the full .vue file
    expect(vueMatch?.line).toBe(4);
    // "const |useCounterRef" — col 7
    expect(vueMatch?.col).toBe(7);
    expect(vueMatch?.kind).toBeTruthy();
  }, 30_000);
});
