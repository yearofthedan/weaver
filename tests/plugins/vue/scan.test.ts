import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateVueImportsAfterMove } from "../../../src/plugins/vue/scan.js";

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

    updateVueImportsAfterMove(oldPath, newPath, tmpDir, tmpDir);

    const result = fs.readFileSync(vueFile, "utf8");
    expect(result).toContain("from './helpers.js'");
    expect(result).not.toContain("from './utils'");
  });

  it("rewrites a parent-directory import", () => {
    const oldPath = path.join(tmpDir, "shared/utils.ts");
    const newPath = path.join(tmpDir, "shared/helpers.ts");
    const vueFile = writeVue(
      "components/Comp.vue",
      `<script setup>\nimport foo from '../shared/utils'\n</script>`,
    );

    updateVueImportsAfterMove(oldPath, newPath, tmpDir, tmpDir);

    const result = fs.readFileSync(vueFile, "utf8");
    expect(result).toContain("from '../shared/helpers.js'");
    expect(result).not.toContain("from '../shared/utils'");
  });

  it("does not rewrite imports that do not match the moved file", () => {
    const oldPath = path.join(tmpDir, "src/target.ts");
    const newPath = path.join(tmpDir, "src/renamed.ts");
    const original = `<script setup>\nimport foo from './other'\n</script>`;
    const vueFile = writeVue("src/Comp.vue", original);

    updateVueImportsAfterMove(oldPath, newPath, tmpDir, tmpDir);

    expect(fs.readFileSync(vueFile, "utf8")).toBe(original);
  });

  it("returns the list of modified files only", () => {
    const oldPath = path.join(tmpDir, "utils.ts");
    const newPath = path.join(tmpDir, "helpers.ts");
    writeVue("A.vue", `<script>\nimport x from './utils'\n</script>`);
    writeVue("B.vue", `<script>\nimport x from './other'\n</script>`);

    const modified = updateVueImportsAfterMove(oldPath, newPath, tmpDir, tmpDir);

    expect(modified).toHaveLength(1);
    expect(path.basename(modified[0])).toBe("A.vue");
  });

  it("returns empty array when no .vue files are present", () => {
    const oldPath = path.join(tmpDir, "utils.ts");
    const newPath = path.join(tmpDir, "helpers.ts");

    expect(updateVueImportsAfterMove(oldPath, newPath, tmpDir, tmpDir)).toEqual([]);
  });

  it("skips files outside workspace and does not write them", () => {
    const workspace = path.join(tmpDir, "src");
    fs.mkdirSync(workspace, { recursive: true });

    const oldPath = path.join(tmpDir, "src/utils.ts");
    const newPath = path.join(tmpDir, "src/helpers.ts");

    // This .vue file is outside the workspace (in other/, not src/)
    const outsideVue = writeVue(
      "other/Comp.vue",
      `<script setup>\nimport foo from '../src/utils'\n</script>`,
    );
    const originalContent = fs.readFileSync(outsideVue, "utf8");

    const modified = updateVueImportsAfterMove(oldPath, newPath, tmpDir, workspace);

    expect(modified).toHaveLength(0);
    // File must not have been written
    expect(fs.readFileSync(outsideVue, "utf8")).toBe(originalContent);
  });

  it("handles double-quoted imports", () => {
    const oldPath = path.join(tmpDir, "src/utils.ts");
    const newPath = path.join(tmpDir, "src/helpers.ts");
    const vueFile = writeVue("src/Comp.vue", `<script>\nimport foo from "./utils"\n</script>`);

    updateVueImportsAfterMove(oldPath, newPath, tmpDir, tmpDir);

    expect(fs.readFileSync(vueFile, "utf8")).toContain('from "./helpers.js"');
  });

  it("rewrites a deeply-nested import", () => {
    const oldPath = path.join(tmpDir, "lib/deep/util.ts");
    const newPath = path.join(tmpDir, "lib/deep/renamed.ts");
    const vueFile = writeVue(
      "views/Page.vue",
      `<script>\nimport x from '../lib/deep/util'\n</script>`,
    );

    updateVueImportsAfterMove(oldPath, newPath, tmpDir, tmpDir);

    const result = fs.readFileSync(vueFile, "utf8");
    expect(result).toContain("from '../lib/deep/renamed.js'");
  });

  it("rewrites import with multiple spaces after from keyword", () => {
    const oldPath = path.join(tmpDir, "src/utils.ts");
    const newPath = path.join(tmpDir, "src/helpers.ts");
    const vueFile = writeVue(
      "src/Comp.vue",
      `<script setup>\nimport foo from  './utils'\n</script>`,
    );

    updateVueImportsAfterMove(oldPath, newPath, tmpDir, tmpDir);

    // The replacement normalises whitespace to a single space.
    // The key assertion is that the rewrite DID happen (two-space import was matched).
    const result = fs.readFileSync(vueFile, "utf8");
    expect(result).toContain("from './helpers.js'");
    expect(result).not.toContain("'./utils'");
  });
});
