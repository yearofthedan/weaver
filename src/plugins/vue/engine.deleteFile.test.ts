import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../../domain/workspace-scope.js";
import { NodeFileSystem } from "../../ports/node-filesystem.js";
import { TsMorphEngine } from "../../ts-engine/engine.js";
import { VolarEngine } from "./engine.js";

function makeScope(root: string): WorkspaceScope {
  return new WorkspaceScope(root, new NodeFileSystem());
}

test.override({ fixtureName: FIXTURES.deleteFileTs.name });

test("removes named and type-only import lines from Vue script blocks", async ({ dir }) => {
  const vueFile = path.join(dir, "src", "Comp.vue");
  fs.writeFileSync(
    vueFile,
    [
      '<script setup lang="ts">',
      "import { targetFn } from './target';",
      "import type { TargetType } from './target';",
      "import * as All from './target';",
      "const x = targetFn();",
      "</script>",
      "<template><div>hello</div></template>",
    ].join("\n"),
    "utf8",
  );

  const scope = makeScope(dir);
  const p = new VolarEngine(new TsMorphEngine());
  await p.deleteFile(`${dir}/src/target.ts`, scope);

  expect(scope.modified).toContain(vueFile);
  const content = fs.readFileSync(vueFile, "utf8");
  expect(content).not.toMatch(/from ['"]\.\/target['"]/);
  expect(content).toContain("const x = targetFn();");
  expect(content).toContain("<template>");
});

test("removes bare side-effect import lines from Vue script blocks", async ({ dir }) => {
  const vueFile = path.join(dir, "src", "SideEffect.vue");
  fs.writeFileSync(
    vueFile,
    ["<script setup>", "import './target';", "const x = 1;", "</script>"].join("\n"),
    "utf8",
  );

  const scope = makeScope(dir);
  const p = new VolarEngine(new TsMorphEngine());
  await p.deleteFile(`${dir}/src/target.ts`, scope);

  expect(scope.modified).toContain(vueFile);
  const content = fs.readFileSync(vueFile, "utf8");
  expect(content).not.toContain("import './target'");
  expect(content).toContain("const x = 1;");
});

test("does not modify Vue files that do not import the deleted file", async ({ dir }) => {
  const originalContent = [
    "<script setup>",
    "import { other } from './other-module';",
    "const x = 1;",
    "</script>",
  ].join("\n");
  const vueFile = path.join(dir, "src", "Unrelated.vue");
  fs.writeFileSync(vueFile, originalContent, "utf8");

  const scope = makeScope(dir);
  const p = new VolarEngine(new TsMorphEngine());
  await p.deleteFile(`${dir}/src/target.ts`, scope);

  expect(fs.readFileSync(vueFile, "utf8")).toBe(originalContent);
  expect(scope.modified).not.toContain(vueFile);
});

test("counts Vue import removals in importRefsRemoved on top of TS refs", async ({ dir }) => {
  const vueFile = path.join(dir, "src", "VueRefs.vue");
  fs.writeFileSync(
    vueFile,
    [
      "<script setup>",
      "import { targetFn } from './target';",
      "import type { TargetType } from './target';",
      "</script>",
    ].join("\n"),
    "utf8",
  );

  // TS files: importer.ts (2) + barrel.ts (2) + tests/out-of-project.ts (1) = 5
  // Vue file adds 2 more = 7 total
  // TsMorphEngine(dir) expands the project graph to include tests/out-of-project.ts
  const scope = makeScope(dir);
  const p = new VolarEngine(new TsMorphEngine(dir));
  const result = await p.deleteFile(`${dir}/src/target.ts`, scope);

  expect(result.importRefsRemoved).toBe(7);
});

test("also removes TS importers when deleting a TS file via VolarEngine", async ({ dir }) => {
  const scope = makeScope(dir);
  const p = new VolarEngine(new TsMorphEngine());
  await p.deleteFile(`${dir}/src/target.ts`, scope);

  expect(scope.modified).toContain(`${dir}/src/importer.ts`);
  expect(fs.readFileSync(path.join(dir, "src/importer.ts"), "utf8")).not.toMatch(
    /from ['"]\.\/target['"]/,
  );
});
