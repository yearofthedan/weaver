import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test as baseTest } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export const FIXTURES = {
  simpleTs: {
    name: "simple-ts",
    desc: "Two TS files (main, utils) + test importing across src/ boundary",
  },
  tsErrors: {
    name: "ts-errors",
    desc: "Mixed error types: basic TS2345, chained diagnostics, 102+ TS2322 in many-errors",
  },
  ts100Errors: { name: "ts-100-errors", desc: "Single file with exactly 100 TS2322 errors" },
  deleteFileTs: {
    name: "delete-file-ts",
    desc: "Barrel re-export + type-only import + out-of-project importer of target.ts",
  },
  crossBoundary: {
    name: "cross-boundary",
    desc: "Two directories (consumer + workspace), ESM .js extensions, tsconfig spans both roots",
  },
  multiImporter: {
    name: "multi-importer",
    desc: "One symbol (add) imported by two independent consumers (featureA, featureB)",
  },
  vueProject: {
    name: "vue-project",
    desc: "Vue SFC + composable (useCounter) + cross-boundary test",
  },
  vueTsBoundary: { name: "vue-ts-boundary", desc: "Minimal Vue SFC importing a single TS utility" },
  moveDirTs: {
    name: "move-dir-ts",
    desc: "Nested utils/{a,b,nested/c} with sibling imports, no ESM extensions",
  },
  moveDirTsEsm: {
    name: "move-dir-ts-esm",
    desc: "Same topology as moveDirTs but with .js ESM extensions and nodenext resolution",
  },
  moveDirVue: {
    name: "move-dir-vue",
    desc: "Vue components (App, Button) importing sibling .ts and child .vue files",
  },
  moveDirSubproject: {
    name: "move-dir-subproject",
    desc: "Subproject (pkg/) with own tsconfig, root tsconfig excludes it",
  },
  moveDirVueExternal: {
    name: "move-dir-vue-external",
    desc: "Vue project with components/ and composables/ dirs; .ts and .vue files import across boundaries for moveDirectory Volar tests",
  },
  vueErrors: {
    name: "vue-errors",
    desc: "Vue SFC with deliberate type errors in script setup (Broken.vue) and a clean SFC (Clean.vue) for getTypeErrors integration tests",
  },
} as const satisfies Record<string, { name: string; desc: string }>;

export type FixtureName = (typeof FIXTURES)[keyof typeof FIXTURES]["name"];

export function copyFixture(name: FixtureName): string {
  const src = path.join(__dirname, name);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), `ns-${name}-`));
  copyDirSync(src, dest);
  return dest;
}

/**
 * Vitest `test` with a fresh empty temp dir per test and two body-level helpers
 * to seed it:
 *
 * ```ts
 * test("inline files", async ({ dir, seedInlineFixture }) => {
 *   await seedInlineFixture({ "tsconfig.json": "...", "src/a.ts": "..." });
 * });
 *
 * test("from a named fixture", async ({ dir, seedNamedFixture }) => {
 *   await seedNamedFixture(FIXTURES.simpleTs.name);
 * });
 * ```
 *
 * Helpers compose: later writes overwrite earlier ones at the same path.
 * The temp dir is removed after the test regardless of which helpers ran.
 */
export const fixtureTest = baseTest.extend<{
  dir: string;
  seedNamedFixture: (name: FixtureName) => Promise<void>;
  seedInlineFixture: (files: Record<string, string>) => Promise<void>;
}>({
  dir: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-"));
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  },
  seedNamedFixture: async ({ dir }, use) => {
    await use(async (name) => {
      copyDirSync(path.join(__dirname, name), dir);
    });
  },
  seedInlineFixture: async ({ dir }, use) => {
    await use(async (files) => {
      for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
      }
    });
  },
});

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDirSync(s, d) : fs.copyFileSync(s, d);
  }
}
