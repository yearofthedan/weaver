import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { moveFile } from "../../src/operations/moveFile.js";
import { VolarCompiler } from "../../src/plugins/vue/compiler.js";
import { updateVueImportsAfterMove } from "../../src/plugins/vue/scan.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";
import { findTsConfigForFile } from "../../src/utils/ts-project.js";
import { cleanup, copyFixture, fileExists, readFile } from "../helpers.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("moveFile action - VolarCompiler Integration", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("moves a composable file and updates .vue imports", async () => {
    const dir = copyFixture("vue-project");
    dirs.push(dir);
    const compiler = new VolarCompiler();

    const oldPath = `${dir}/src/composables/useCounter.ts`;
    const newPath = `${dir}/src/utils/useCounter.ts`;

    const result = await moveFile(compiler, oldPath, newPath, makeScope(dir));

    expect(result.oldPath).toBe(oldPath);
    expect(result.newPath).toBe(newPath);
    expect(fileExists(dir, "src/composables/useCounter.ts")).toBe(false);
    expect(fileExists(dir, "src/utils/useCounter.ts")).toBe(true);

    // Post-step: scan .vue files for import rewrites (mirrors what dispatcher does)
    const tsConfig = findTsConfigForFile(oldPath);
    const searchRoot = tsConfig ? path.dirname(tsConfig) : path.dirname(oldPath);
    const vueModified = updateVueImportsAfterMove(oldPath, newPath, searchRoot, dir);
    for (const f of vueModified) {
      if (!result.filesModified.includes(f)) result.filesModified.push(f);
    }

    const vueContent = readFile(dir, "src/App.vue");
    expect(vueContent).toContain("utils/useCounter");
    expect(vueContent).not.toContain("composables/useCounter");

    expect(result.filesModified).toContain(`${dir}/src/App.vue`);
  });

  it("updates imports on move-back with the same compiler instance", async () => {
    const dir = copyFixture("vue-project");
    dirs.push(dir);
    const compiler = new VolarCompiler();

    await moveFile(
      compiler,
      `${dir}/src/composables/useCounter.ts`,
      `${dir}/src/utils/useCounter.ts`,
      makeScope(dir),
    );
    expect(readFile(dir, "src/main.ts")).toContain("utils/useCounter");

    await moveFile(
      compiler,
      `${dir}/src/utils/useCounter.ts`,
      `${dir}/src/composables/useCounter.ts`,
      makeScope(dir),
    );

    expect(fileExists(dir, "src/composables/useCounter.ts")).toBe(true);
    expect(fileExists(dir, "src/utils/useCounter.ts")).toBe(false);
    const mainContent = readFile(dir, "src/main.ts");
    expect(mainContent).toContain("composables/useCounter");
    expect(mainContent).not.toContain("utils/useCounter");
  });

  it("throws FILE_NOT_FOUND for non-existent source", async () => {
    const dir = copyFixture("vue-project");
    dirs.push(dir);
    const compiler = new VolarCompiler();

    await expect(
      moveFile(
        compiler,
        `${dir}/src/doesNotExist.ts`,
        `${dir}/src/utils/doesNotExist.ts`,
        makeScope(dir),
      ),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });
});
