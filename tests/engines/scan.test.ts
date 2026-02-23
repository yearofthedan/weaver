import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  updateVueImportsAfterMove,
  updateVueNamedImportAfterSymbolMove,
} from "../../src/providers/vue-scan.js";

// rewriteImports and computeRelativeSpecifier are private to their modules;
// tested here through the public updateVueImportsAfterMove API.

describe("updateVueImportsAfterMove", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeVue(relPath: string, content: string): string {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    return full;
  }

  it("rewrites a same-directory import", () => {
    const oldPath = path.join(tmpDir, "src/utils.ts");
    const newPath = path.join(tmpDir, "src/helpers.ts");
    const vueFile = writeVue(
      "src/Comp.vue",
      `<script setup>\nimport foo from './utils'\n</script>`,
    );

    updateVueImportsAfterMove(oldPath, newPath, tmpDir);

    const result = fs.readFileSync(vueFile, "utf8");
    expect(result).toContain("from './helpers'");
    expect(result).not.toContain("from './utils'");
  });

  it("rewrites a parent-directory import", () => {
    const oldPath = path.join(tmpDir, "shared/utils.ts");
    const newPath = path.join(tmpDir, "shared/helpers.ts");
    const vueFile = writeVue(
      "components/Comp.vue",
      `<script setup>\nimport foo from '../shared/utils'\n</script>`,
    );

    updateVueImportsAfterMove(oldPath, newPath, tmpDir);

    const result = fs.readFileSync(vueFile, "utf8");
    expect(result).toContain("from '../shared/helpers'");
    expect(result).not.toContain("from '../shared/utils'");
  });

  it("does not rewrite imports that do not match the moved file", () => {
    const oldPath = path.join(tmpDir, "src/target.ts");
    const newPath = path.join(tmpDir, "src/renamed.ts");
    const original = `<script setup>\nimport foo from './other'\n</script>`;
    const vueFile = writeVue("src/Comp.vue", original);

    updateVueImportsAfterMove(oldPath, newPath, tmpDir);

    expect(fs.readFileSync(vueFile, "utf8")).toBe(original);
  });

  it("returns the list of modified files only", () => {
    const oldPath = path.join(tmpDir, "utils.ts");
    const newPath = path.join(tmpDir, "helpers.ts");
    writeVue("A.vue", `<script>\nimport x from './utils'\n</script>`);
    writeVue("B.vue", `<script>\nimport x from './other'\n</script>`);

    const modified = updateVueImportsAfterMove(oldPath, newPath, tmpDir);

    expect(modified).toHaveLength(1);
    expect(path.basename(modified[0])).toBe("A.vue");
  });

  it("returns empty array when no .vue files are present", () => {
    const oldPath = path.join(tmpDir, "utils.ts");
    const newPath = path.join(tmpDir, "helpers.ts");

    expect(updateVueImportsAfterMove(oldPath, newPath, tmpDir)).toEqual([]);
  });

  it("handles double-quoted imports", () => {
    const oldPath = path.join(tmpDir, "src/utils.ts");
    const newPath = path.join(tmpDir, "src/helpers.ts");
    const vueFile = writeVue("src/Comp.vue", `<script>\nimport foo from "./utils"\n</script>`);

    updateVueImportsAfterMove(oldPath, newPath, tmpDir);

    expect(fs.readFileSync(vueFile, "utf8")).toContain('from "./helpers"');
  });

  it("rewrites a deeply-nested import", () => {
    const oldPath = path.join(tmpDir, "lib/deep/util.ts");
    const newPath = path.join(tmpDir, "lib/deep/renamed.ts");
    const vueFile = writeVue(
      "views/Page.vue",
      `<script>\nimport x from '../lib/deep/util'\n</script>`,
    );

    updateVueImportsAfterMove(oldPath, newPath, tmpDir);

    const result = fs.readFileSync(vueFile, "utf8");
    expect(result).toContain("from '../lib/deep/renamed'");
  });
});

describe("updateVueNamedImportAfterSymbolMove", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-symbol-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeVue(relPath: string, content: string): string {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    return full;
  }

  it("rewrites a single-symbol import to the new path", () => {
    const sourceFile = path.join(tmpDir, "src/utils.ts");
    const destFile = path.join(tmpDir, "src/helpers.ts");
    const vueFile = writeVue(
      "src/Comp.vue",
      `<script setup>\nimport { myFn } from './utils'\n</script>`,
    );

    updateVueNamedImportAfterSymbolMove(sourceFile, "myFn", destFile, tmpDir, tmpDir);

    const result = fs.readFileSync(vueFile, "utf8");
    expect(result).toContain("from './helpers'");
    expect(result).not.toContain("from './utils'");
  });

  it("splits a multi-symbol import: moves only the named symbol", () => {
    const sourceFile = path.join(tmpDir, "src/utils.ts");
    const destFile = path.join(tmpDir, "src/helpers.ts");
    const vueFile = writeVue(
      "src/Comp.vue",
      `<script setup>\nimport { myFn, otherFn } from './utils'\n</script>`,
    );

    updateVueNamedImportAfterSymbolMove(sourceFile, "myFn", destFile, tmpDir, tmpDir);

    const result = fs.readFileSync(vueFile, "utf8");
    // otherFn stays in the old import
    expect(result).toContain("from './utils'");
    expect(result).toContain("otherFn");
    // myFn gets a new import from helpers
    expect(result).toContain("from './helpers'");
    expect(result).toContain("myFn");
    // myFn is not in the old import any more
    const oldImportMatch = result.match(/import\s*\{[^}]+\}\s*from\s*'\.\/utils'/);
    expect(oldImportMatch?.[0]).not.toContain("myFn");
  });

  it("does not rewrite imports of unrelated symbols from the same file", () => {
    const sourceFile = path.join(tmpDir, "src/utils.ts");
    const destFile = path.join(tmpDir, "src/helpers.ts");
    const original = `<script setup>\nimport { otherFn } from './utils'\n</script>`;
    const vueFile = writeVue("src/Comp.vue", original);

    updateVueNamedImportAfterSymbolMove(sourceFile, "myFn", destFile, tmpDir, tmpDir);

    // otherFn was not moved; file unchanged
    expect(fs.readFileSync(vueFile, "utf8")).toBe(original);
  });

  it("does not rewrite imports from unrelated files", () => {
    const sourceFile = path.join(tmpDir, "src/utils.ts");
    const destFile = path.join(tmpDir, "src/helpers.ts");
    const original = `<script setup>\nimport { myFn } from './other'\n</script>`;
    const vueFile = writeVue("src/Comp.vue", original);

    updateVueNamedImportAfterSymbolMove(sourceFile, "myFn", destFile, tmpDir, tmpDir);

    expect(fs.readFileSync(vueFile, "utf8")).toBe(original);
  });

  it("returns only modified files", () => {
    const sourceFile = path.join(tmpDir, "utils.ts");
    const destFile = path.join(tmpDir, "helpers.ts");
    writeVue("A.vue", `<script>\nimport { fn } from './utils'\n</script>`);
    writeVue("B.vue", `<script>\nimport { fn } from './other'\n</script>`);

    const modified = updateVueNamedImportAfterSymbolMove(
      sourceFile,
      "fn",
      destFile,
      tmpDir,
      tmpDir,
    );

    expect(modified).toHaveLength(1);
    expect(path.basename(modified[0])).toBe("A.vue");
  });

  it("handles double-quoted imports", () => {
    const sourceFile = path.join(tmpDir, "src/utils.ts");
    const destFile = path.join(tmpDir, "src/helpers.ts");
    const vueFile = writeVue("src/Comp.vue", `<script>\nimport { myFn } from "./utils"\n</script>`);

    updateVueNamedImportAfterSymbolMove(sourceFile, "myFn", destFile, tmpDir, tmpDir);

    expect(fs.readFileSync(vueFile, "utf8")).toContain('from "./helpers"');
  });

  it("skips files outside workspace", () => {
    const sourceFile = path.join(tmpDir, "src/utils.ts");
    const destFile = path.join(tmpDir, "src/helpers.ts");
    const workspace = path.join(tmpDir, "src"); // only src/ is the workspace
    writeVue("other/Comp.vue", `<script>\nimport { myFn } from '../src/utils'\n</script>`);

    const modified = updateVueNamedImportAfterSymbolMove(
      sourceFile,
      "myFn",
      destFile,
      tmpDir,
      workspace,
    );

    expect(modified).toHaveLength(0);
  });
});
