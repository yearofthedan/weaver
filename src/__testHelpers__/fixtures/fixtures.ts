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
} as const satisfies Record<string, { name: string; desc: string }>;

export type FixtureName = (typeof FIXTURES)[keyof typeof FIXTURES]["name"];

export function copyFixture(name: FixtureName): string {
  const src = path.join(__dirname, name);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), `ns-${name}-`));
  copyDirSync(src, dest);
  return dest;
}

/**
 * Vitest `test` with a `dir` fixture that copies a named fixture to a temp
 * directory before each test and cleans it up after. Default fixture is
 * `simple-ts`; override per describe block:
 *
 * ```ts
 * describe("my tests", () => {
 *   test.override({ fixtureName: FIXTURES.deleteFileTs.name });
 *   test("uses delete-file-ts fixture", ({ dir }) => { ... });
 * });
 * ```
 */
export const fixtureTest = baseTest.extend<{ fixtureName: FixtureName; dir: string }>({
  fixtureName: async ({}, use) => {
    await use("simple-ts");
  },
  dir: async ({ fixtureName }, use) => {
    const dir = copyFixture(fixtureName);
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
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
