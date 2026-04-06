import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../../domain/workspace-scope.js";
import { NodeFileSystem } from "../../ports/node-filesystem.js";
import {
  removeVueImportsOfDeletedFile,
  rewriteVueOwnImportsAfterMove,
  updateVueImportsAfterMove,
  updateVueImportsAfterSymbolMove,
} from "./scan.js";

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

  function makeScope(dir: string): WorkspaceScope {
    return new WorkspaceScope(dir, new NodeFileSystem());
  }

  it("rewrites a same-directory import", () => {
    const oldPath = path.join(tmpDir, "src/utils.ts");
    const newPath = path.join(tmpDir, "src/helpers.ts");
    const vueFile = writeVue(
      "src/Comp.vue",
      `<script setup>\nimport foo from './utils'\n</script>`,
    );

    updateVueImportsAfterMove(oldPath, newPath, tmpDir, makeScope(tmpDir));

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

    updateVueImportsAfterMove(oldPath, newPath, tmpDir, makeScope(tmpDir));

    const result = fs.readFileSync(vueFile, "utf8");
    expect(result).toContain("from '../shared/helpers.js'");
    expect(result).not.toContain("from '../shared/utils'");
  });

  it("does not rewrite imports that do not match the moved file", () => {
    const oldPath = path.join(tmpDir, "src/target.ts");
    const newPath = path.join(tmpDir, "src/renamed.ts");
    const original = `<script setup>\nimport foo from './other'\n</script>`;
    const vueFile = writeVue("src/Comp.vue", original);

    updateVueImportsAfterMove(oldPath, newPath, tmpDir, makeScope(tmpDir));

    expect(fs.readFileSync(vueFile, "utf8")).toBe(original);
  });

  it("records modified files in scope.modified", () => {
    const oldPath = path.join(tmpDir, "utils.ts");
    const newPath = path.join(tmpDir, "helpers.ts");
    writeVue("A.vue", `<script>\nimport x from './utils'\n</script>`);
    writeVue("B.vue", `<script>\nimport x from './other'\n</script>`);

    const scope = makeScope(tmpDir);
    updateVueImportsAfterMove(oldPath, newPath, tmpDir, scope);

    expect(scope.modified).toHaveLength(1);
    expect(path.basename(scope.modified[0])).toBe("A.vue");
  });

  it("scope.modified is empty when no .vue files are present", () => {
    const oldPath = path.join(tmpDir, "utils.ts");
    const newPath = path.join(tmpDir, "helpers.ts");

    const scope = makeScope(tmpDir);
    updateVueImportsAfterMove(oldPath, newPath, tmpDir, scope);

    expect(scope.modified).toEqual([]);
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

    const scope = makeScope(workspace);
    updateVueImportsAfterMove(oldPath, newPath, tmpDir, scope);

    expect(scope.modified).toHaveLength(0);
    // File must not have been written
    expect(fs.readFileSync(outsideVue, "utf8")).toBe(originalContent);
  });

  it("handles double-quoted imports", () => {
    const oldPath = path.join(tmpDir, "src/utils.ts");
    const newPath = path.join(tmpDir, "src/helpers.ts");
    const vueFile = writeVue("src/Comp.vue", `<script>\nimport foo from "./utils"\n</script>`);

    updateVueImportsAfterMove(oldPath, newPath, tmpDir, makeScope(tmpDir));

    expect(fs.readFileSync(vueFile, "utf8")).toContain('from "./helpers.js"');
  });

  it("rewrites a deeply-nested import", () => {
    const oldPath = path.join(tmpDir, "lib/deep/util.ts");
    const newPath = path.join(tmpDir, "lib/deep/renamed.ts");
    const vueFile = writeVue(
      "views/Page.vue",
      `<script>\nimport x from '../lib/deep/util'\n</script>`,
    );

    updateVueImportsAfterMove(oldPath, newPath, tmpDir, makeScope(tmpDir));

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

    updateVueImportsAfterMove(oldPath, newPath, tmpDir, makeScope(tmpDir));

    // The replacement normalises whitespace to a single space.
    // The key assertion is that the rewrite DID happen (two-space import was matched).
    const result = fs.readFileSync(vueFile, "utf8");
    expect(result).toContain("from './helpers.js'");
    expect(result).not.toContain("'./utils'");
  });

  it("records unreadable .vue files as skipped", () => {
    const oldPath = path.join(tmpDir, "src/utils.ts");
    const newPath = path.join(tmpDir, "src/helpers.ts");
    const vueFile = writeVue(
      "src/Comp.vue",
      `<script setup>\nimport foo from './utils'\n</script>`,
    );
    fs.chmodSync(vueFile, 0o000);

    const scope = makeScope(tmpDir);
    updateVueImportsAfterMove(oldPath, newPath, tmpDir, scope);

    expect(scope.skipped).toContain(vueFile);
    expect(scope.modified).toHaveLength(0);

    fs.chmodSync(vueFile, 0o644);
  });
});

describe("updateVueImportsAfterSymbolMove", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function makeScope(dir: string): WorkspaceScope {
    return new WorkspaceScope(dir, new NodeFileSystem());
  }

  it("is a no-op when no matching .vue files exist", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vue-noop-"));
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src/a.ts"), "export const foo = 1;\n");
    try {
      const scope = makeScope(tmpDir);
      updateVueImportsAfterSymbolMove(
        "foo",
        path.join(tmpDir, "src/a.ts"),
        path.join(tmpDir, "src/b.ts"),
        tmpDir,
        scope,
      );
      expect(scope.modified).toEqual([]);
      expect(scope.skipped).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("records nothing when no .vue files exist in the project", () => {
    const tsDir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(tsDir);
    const scope = makeScope(tsDir);
    updateVueImportsAfterSymbolMove(
      "greetUser",
      path.join(tsDir, "src/utils.ts"),
      path.join(tsDir, "src/helpers.ts"),
      tsDir,
      scope,
    );
    expect(scope.modified).toEqual([]);
    expect(scope.skipped).toEqual([]);
  });

  it("rewrites a matching named import in a .vue file", () => {
    const dir = copyFixture(FIXTURES.vueProject.name);
    dirs.push(dir);
    const scope = makeScope(dir);
    const sourceFile = path.join(dir, "src/composables/useCounter.ts");
    const destFile = path.join(dir, "src/composables/useTimer.ts");
    updateVueImportsAfterSymbolMove("useCounter", sourceFile, destFile, dir, scope);

    const appVue = path.join(dir, "src/App.vue");
    expect(scope.modified).toContain(appVue);
    const content = fs.readFileSync(appVue, "utf8");
    expect(content).toContain("useTimer");
    expect(content).not.toContain("useCounter.js");
    expect(content).not.toContain('from "./composables/useCounter"');
  });

  it("skips .vue files already in scope.modified", () => {
    const dir = copyFixture(FIXTURES.vueProject.name);
    dirs.push(dir);
    const scope = makeScope(dir);
    const appVue = path.join(dir, "src/App.vue");
    // Pre-mark App.vue as already modified
    scope.writeFile(appVue, fs.readFileSync(appVue, "utf8"));
    const contentBefore = fs.readFileSync(appVue, "utf8");

    const sourceFile = path.join(dir, "src/composables/useCounter.ts");
    const destFile = path.join(dir, "src/composables/useTimer.ts");
    updateVueImportsAfterSymbolMove("useCounter", sourceFile, destFile, dir, scope);

    // App.vue was already modified; Vue SFC scanning must skip it
    const contentAfter = fs.readFileSync(appVue, "utf8");
    expect(contentAfter).toBe(contentBefore);
  });

  it("does not modify .vue files that do not import the symbol", () => {
    const dir = copyFixture(FIXTURES.vueProject.name);
    dirs.push(dir);
    const scope = makeScope(dir);
    const sourceFile = path.join(dir, "src/composables/useCounter.ts");
    const destFile = path.join(dir, "src/composables/useTimer.ts");
    updateVueImportsAfterSymbolMove("nonExistentSymbol", sourceFile, destFile, dir, scope);

    expect(scope.modified).toEqual([]);
  });
});

describe("removeVueImportsOfDeletedFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-rm-test-"));
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

  function makeScope(dir: string): WorkspaceScope {
    return new WorkspaceScope(dir, new NodeFileSystem());
  }

  it("records unreadable .vue files as skipped", () => {
    const deletedFile = path.join(tmpDir, "src/utils.ts");
    const vueFile = writeVue(
      "src/Comp.vue",
      `<script setup>\nimport foo from './utils'\n</script>`,
    );
    fs.chmodSync(vueFile, 0o000);

    const scope = makeScope(tmpDir);
    removeVueImportsOfDeletedFile(deletedFile, tmpDir, scope);

    expect(scope.skipped).toContain(vueFile);

    fs.chmodSync(vueFile, 0o644);
  });
});

describe("rewriteVueOwnImportsAfterMove", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-own-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(relPath: string, content: string): string {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    return full;
  }

  function makeScope(): WorkspaceScope {
    return new WorkspaceScope(tmpDir, new NodeFileSystem());
  }

  it("rewrites a relative import that no longer resolves from the new location", () => {
    write("src/utils/helper.ts", "");
    const content = `<script setup>\nimport { h } from '../utils/helper'\n</script>`;
    // File moved from src/components/Button.vue → src/ui/components/Button.vue
    const oldPath = path.join(tmpDir, "src/components/Button.vue");
    const newPath = path.join(tmpDir, "src/ui/components/Button.vue");
    write("src/ui/components/Button.vue", content);

    rewriteVueOwnImportsAfterMove(oldPath, newPath, makeScope());

    const result = fs.readFileSync(newPath, "utf8");
    expect(result).toContain("../../utils/helper");
    expect(result).not.toContain("'../utils/helper'");
  });

  it("does not rewrite an intra-directory import that still resolves from the new location", () => {
    // Both files moved together — relative import between them is still valid
    write("src/ui/components/Button.vue", "");
    const content = `<script setup>\nimport Icon from './Icon.vue'\n</script>`;
    write("src/ui/components/Card.vue", content);

    const oldPath = path.join(tmpDir, "src/components/Card.vue");
    const newPath = path.join(tmpDir, "src/ui/components/Card.vue");

    rewriteVueOwnImportsAfterMove(oldPath, newPath, makeScope());

    const result = fs.readFileSync(newPath, "utf8");
    expect(result).toContain("'./Icon.vue'");
  });

  it("does not rewrite an import that resolves from neither old nor new location", () => {
    const content = `<script setup>\nimport { x } from '../missing/module'\n</script>`;
    const oldPath = path.join(tmpDir, "src/components/Button.vue");
    const newPath = path.join(tmpDir, "src/ui/Button.vue");
    write("src/ui/Button.vue", content);

    rewriteVueOwnImportsAfterMove(oldPath, newPath, makeScope());

    const result = fs.readFileSync(newPath, "utf8");
    expect(result).toContain("'../missing/module'");
  });

  it("does nothing when the new file does not exist", () => {
    const oldPath = path.join(tmpDir, "src/components/Button.vue");
    const newPath = path.join(tmpDir, "src/ui/Button.vue");
    const scope = makeScope();

    // Should not throw
    rewriteVueOwnImportsAfterMove(oldPath, newPath, scope);
    expect(scope.modified).toHaveLength(0);
  });
});
