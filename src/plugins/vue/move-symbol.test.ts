import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceScope } from "../../domain/workspace-scope.js";
import { NodeFileSystem } from "../../ports/node-filesystem.js";
import { vueMoveSymbol } from "./move-symbol.js";

function makeTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeScope(root: string): WorkspaceScope {
  return new WorkspaceScope(root, new NodeFileSystem());
}

function writeFile(dir: string, rel: string, content: string): string {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

describe("vueMoveSymbol", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  describe("extracting from <script setup> to a .ts dest", () => {
    it("removes the export from <script setup> and writes it to a new .ts file", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/App.vue",
        [
          '<script setup lang="ts">',
          "export function formatLabel(n: number): string {",
          "  return String(n);",
          "}",
          "",
          "const x = 1;",
          "</script>",
          "",
          "<template>",
          "  <div>{{ x }}</div>",
          "</template>",
          "",
        ].join("\n"),
      );
      const dest = path.join(dir, "src/utils/format.ts");
      const scope = makeScope(dir);

      await vueMoveSymbol(source, "formatLabel", dest, scope);

      const updatedSource = fs.readFileSync(source, "utf8");
      expect(updatedSource).not.toContain("formatLabel");
      expect(updatedSource).toContain("const x = 1;");
      expect(updatedSource).toContain("<template>");
      expect(updatedSource).toContain("<div>{{ x }}</div>");

      const destContent = fs.readFileSync(dest, "utf8");
      expect(destContent).toContain("export function formatLabel");
      expect(destContent).toContain("return String(n)");

      expect(scope.modified).toContain(source);
      expect(scope.modified).toContain(dest);
    });

    it("appends the declaration when the .ts dest already exists", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/App.vue",
        ['<script setup lang="ts">', "export const GREETING = 'hi';", "</script>", ""].join("\n"),
      );
      const dest = writeFile(dir, "src/utils/constants.ts", "export const FAREWELL = 'bye';\n");
      const scope = makeScope(dir);

      await vueMoveSymbol(source, "GREETING", dest, scope);

      const destContent = fs.readFileSync(dest, "utf8");
      expect(destContent).toContain("export const FAREWELL = 'bye'");
      expect(destContent).toContain("export const GREETING = 'hi'");
    });

    it("appends the declaration to an empty .ts dest file", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/App.vue",
        ['<script setup lang="ts">', "export const TAG = 'x';", "</script>", ""].join("\n"),
      );
      const dest = writeFile(dir, "src/constants.ts", "");
      const scope = makeScope(dir);

      await vueMoveSymbol(source, "TAG", dest, scope);

      const destContent = fs.readFileSync(dest, "utf8");
      expect(destContent).toContain("export const TAG = 'x'");
    });

    it("throws NOT_SUPPORTED when the .vue source has no <script setup> block", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/Template.vue",
        ["<template>", "  <div>no script</div>", "</template>", ""].join("\n"),
      );
      const dest = path.join(dir, "src/utils.ts");
      const scope = makeScope(dir);

      await expect(vueMoveSymbol(source, "anything", dest, scope)).rejects.toMatchObject({
        code: "NOT_SUPPORTED",
      });
      expect(scope.modified).toEqual([]);
      expect(fs.existsSync(dest)).toBe(false);
    });

    it("throws NOT_SUPPORTED when the .vue source has only a classic <script> block", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/Classic.vue",
        [
          '<script lang="ts">',
          "export default { name: 'Classic' };",
          "export const helper = 1;",
          "</script>",
          "",
        ].join("\n"),
      );
      const dest = path.join(dir, "src/utils.ts");
      const scope = makeScope(dir);

      await expect(vueMoveSymbol(source, "helper", dest, scope)).rejects.toMatchObject({
        code: "NOT_SUPPORTED",
      });
    });

    it("throws SYMBOL_NOT_FOUND when the symbol is absent from <script setup>", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/App.vue",
        ['<script setup lang="ts">', "export const A = 1;", "</script>", ""].join("\n"),
      );
      const dest = path.join(dir, "src/utils.ts");
      const scope = makeScope(dir);

      await expect(vueMoveSymbol(source, "missing", dest, scope)).rejects.toMatchObject({
        code: "SYMBOL_NOT_FOUND",
      });
      expect(fs.existsSync(dest)).toBe(false);
    });

    it("throws NOT_SUPPORTED when the symbol is a re-export via export { } from", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      writeFile(dir, "src/other.ts", "export const foo = 1;\n");
      const source = writeFile(
        dir,
        "src/App.vue",
        ['<script setup lang="ts">', 'export { foo } from "./other";', "</script>", ""].join("\n"),
      );
      const dest = path.join(dir, "src/utils.ts");
      const scope = makeScope(dir);

      await expect(vueMoveSymbol(source, "foo", dest, scope)).rejects.toMatchObject({
        code: "NOT_SUPPORTED",
      });
    });

    it("throws NOT_SUPPORTED when the symbol uses export { x } without a from specifier", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/App.vue",
        ['<script setup lang="ts">', "const inner = 1;", "export { inner };", "</script>", ""].join(
          "\n",
        ),
      );
      const dest = path.join(dir, "src/utils.ts");
      const scope = makeScope(dir);

      await expect(vueMoveSymbol(source, "inner", dest, scope)).rejects.toMatchObject({
        code: "NOT_SUPPORTED",
      });
      expect(fs.existsSync(dest)).toBe(false);
    });

    it("rewrites .ts and .vue importers; leaves unrelated files alone", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/lib/Source.vue",
        [
          '<script setup lang="ts">',
          "export function shared() { return 1; }",
          "</script>",
          "",
        ].join("\n"),
      );
      const tsImporter = writeFile(
        dir,
        "src/uses-shared.ts",
        ['import { shared } from "./lib/Source.vue";', "export const v = shared();", ""].join("\n"),
      );
      const vueImporter = writeFile(
        dir,
        "src/Caller.vue",
        [
          '<script setup lang="ts">',
          'import { shared } from "./lib/Source.vue";',
          "const v = shared();",
          "</script>",
          "<template><div>{{ v }}</div></template>",
          "",
        ].join("\n"),
      );
      const tsUnrelated = writeFile(dir, "src/unrelated.ts", "export const z = 1;\n");
      const tsUnrelatedBefore = fs.readFileSync(tsUnrelated, "utf8");

      const dest = path.join(dir, "src/utils/shared.ts");
      const scope = makeScope(dir);

      await vueMoveSymbol(source, "shared", dest, scope);

      const tsUpdated = fs.readFileSync(tsImporter, "utf8");
      expect(tsUpdated).toContain('from "./utils/shared.js"');
      expect(tsUpdated).not.toContain('from "./lib/Source.vue"');

      const vueUpdated = fs.readFileSync(vueImporter, "utf8");
      expect(vueUpdated).toContain("./utils/shared");
      expect(vueUpdated).not.toContain("./lib/Source.vue");
      expect(vueUpdated).toContain("<template><div>{{ v }}</div></template>");

      expect(fs.readFileSync(tsUnrelated, "utf8")).toBe(tsUnrelatedBefore);
      expect(scope.modified).toContain(tsImporter);
      expect(scope.modified).toContain(vueImporter);
      expect(scope.modified).not.toContain(tsUnrelated);
    });

    it("prepends a self-import when the symbol is still used in <script setup>", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/App.vue",
        [
          '<script setup lang="ts">',
          "export function helper(): number { return 42; }",
          "const v = helper();",
          "</script>",
          "<template><div>{{ v }}</div></template>",
          "",
        ].join("\n"),
      );
      const dest = path.join(dir, "src/utils/helper.ts");
      const scope = makeScope(dir);

      await vueMoveSymbol(source, "helper", dest, scope);

      const updated = fs.readFileSync(source, "utf8");
      expect(updated).toMatch(
        /import\s*\{\s*helper\s*\}\s*from\s*["']\.\/utils\/helper(\.js)?["']/,
      );
      expect(updated).toContain("const v = helper();");
      expect(updated).not.toMatch(/export\s+function\s+helper/);
    });

    it("does NOT add a self-import when the symbol is not referenced locally", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/App.vue",
        [
          '<script setup lang="ts">',
          "export const ONLY_EXPORTED = 1;",
          "const other = 2;",
          "</script>",
          "<template><div>{{ other }}</div></template>",
          "",
        ].join("\n"),
      );
      const dest = path.join(dir, "src/constants.ts");
      const scope = makeScope(dir);

      await vueMoveSymbol(source, "ONLY_EXPORTED", dest, scope);

      const updated = fs.readFileSync(source, "utf8");
      expect(updated).not.toContain("ONLY_EXPORTED");
    });

    it("leaves <template> and <style> byte-for-byte unchanged", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const templateAndStyle = [
        "",
        "<template>",
        "  <div>hello</div>",
        "</template>",
        "",
        "<style scoped>",
        ".foo { color: red; }",
        "</style>",
        "",
      ].join("\n");
      const source = writeFile(
        dir,
        "src/App.vue",
        ['<script setup lang="ts">', "export const X = 1;", "</script>"].join("\n") +
          templateAndStyle,
      );
      const dest = path.join(dir, "src/utils.ts");
      const scope = makeScope(dir);

      await vueMoveSymbol(source, "X", dest, scope);

      const updated = fs.readFileSync(source, "utf8");
      expect(updated.endsWith(templateAndStyle)).toBe(true);
    });
  });

  describe("writing to a .vue destination", () => {
    it("appends the declaration inside an existing <script setup> in the dest .vue", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/Source.vue",
        ['<script setup lang="ts">', "export const SHARED = 1;", "</script>", ""].join("\n"),
      );
      const dest = writeFile(
        dir,
        "src/Dest.vue",
        [
          '<script setup lang="ts">',
          "const existing = 2;",
          "</script>",
          "<template><div>{{ existing }}</div></template>",
          "",
        ].join("\n"),
      );
      const scope = makeScope(dir);

      await vueMoveSymbol(source, "SHARED", dest, scope);

      const updatedDest = fs.readFileSync(dest, "utf8");
      // Both declarations present inside the single script block
      expect(updatedDest.split("<script setup").length).toBe(2);
      const scriptEnd = updatedDest.indexOf("</script>");
      const scriptBlock = updatedDest.slice(0, scriptEnd);
      expect(scriptBlock).toContain("const existing = 2;");
      expect(scriptBlock).toContain("export const SHARED = 1;");
      // No extra blank lines from broken trailing-whitespace trim
      expect(updatedDest).not.toMatch(/\n{3}/);
      // Template preserved after the script block, exactly once
      expect(updatedDest.split("<template>").length).toBe(2);
      expect(scriptEnd).toBeLessThan(updatedDest.indexOf("<template>"));
      expect(scope.modified).toContain(dest);
    });

    it("inserts a new <script setup> block before <template> when dest has no script", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/Source.vue",
        ['<script setup lang="ts">', "export const X = 42;", "</script>", ""].join("\n"),
      );
      const dest = writeFile(
        dir,
        "src/Dest.vue",
        ["<template>", "  <div>hi</div>", "</template>", ""].join("\n"),
      );
      const scope = makeScope(dir);

      await vueMoveSymbol(source, "X", dest, scope);

      const updated = fs.readFileSync(dest, "utf8");
      expect(updated).toContain('<script setup lang="ts">');
      expect(updated).toContain("export const X = 42;");
      const scriptIdx = updated.indexOf("<script setup");
      const templateIdx = updated.indexOf("<template>");
      expect(scriptIdx).toBeGreaterThanOrEqual(0);
      expect(scriptIdx).toBeLessThan(templateIdx);
      // Template appears exactly once (not duplicated)
      expect(updated.split("<template>").length).toBe(2);
      expect(updated).toContain("<div>hi</div>");
    });

    it("creates a new .vue file with only a <script setup> block when dest does not exist", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/Source.vue",
        ['<script setup lang="ts">', "export type Foo = { id: number };", "</script>", ""].join(
          "\n",
        ),
      );
      const dest = path.join(dir, "src/types/Foo.vue");
      const scope = makeScope(dir);

      await vueMoveSymbol(source, "Foo", dest, scope);

      expect(fs.existsSync(dest)).toBe(true);
      const content = fs.readFileSync(dest, "utf8");
      expect(content).toContain('<script setup lang="ts">');
      expect(content).toContain("export type Foo = { id: number };");
      expect(content).toContain("</script>");
      expect(content).not.toContain("<template>");
    });

    it("appends a new <script setup> block to a .vue dest that has no script and no template", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/Source.vue",
        ['<script setup lang="ts">', "export const Z = 99;", "</script>", ""].join("\n"),
      );
      const dest = writeFile(
        dir,
        "src/StyleOnly.vue",
        ["<style scoped>", ".foo { color: red; }", "</style>", ""].join("\n"),
      );
      const scope = makeScope(dir);

      await vueMoveSymbol(source, "Z", dest, scope);

      const updated = fs.readFileSync(dest, "utf8");
      expect(updated).toContain('<script setup lang="ts">');
      expect(updated).toContain("export const Z = 99;");
      expect(updated).toContain(".foo { color: red; }");
    });

    it("rewrites .ts importers when moving to a .vue dest", async () => {
      const dir = makeTmp("vue-movesym-");
      dirs.push(dir);
      const source = writeFile(
        dir,
        "src/Source.vue",
        ['<script setup lang="ts">', "export const TAG = 'hello';", "</script>", ""].join("\n"),
      );
      const importer = writeFile(
        dir,
        "src/uses.ts",
        ['import { TAG } from "./Source.vue";', "export const v = TAG;", ""].join("\n"),
      );
      const dest = writeFile(
        dir,
        "src/Dest.vue",
        ['<script setup lang="ts">', "const x = 1;", "</script>", ""].join("\n"),
      );
      const scope = makeScope(dir);

      await vueMoveSymbol(source, "TAG", dest, scope);

      const updated = fs.readFileSync(importer, "utf8");
      expect(updated).toContain("./Dest.vue");
      expect(updated).not.toContain("./Source.vue");
    });
  });
});
