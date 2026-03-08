import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";
import { TsProvider } from "../../src/providers/ts.js";
import { tsMoveSymbol } from "../../src/providers/ts-move-symbol.js";
import { cleanup, copyFixture, readFile } from "../helpers.js";

function makeScope(root: string): WorkspaceScope {
  return new WorkspaceScope(root, new NodeFileSystem());
}

function setupSimpleTs(): { dir: string; tsProvider: TsProvider; scope: WorkspaceScope } {
  const dir = copyFixture("simple-ts");
  return { dir, tsProvider: new TsProvider(), scope: makeScope(dir) };
}

function setupMultiImporter(): { dir: string; tsProvider: TsProvider; scope: WorkspaceScope } {
  const dir = copyFixture("multi-importer");
  return { dir, tsProvider: new TsProvider(), scope: makeScope(dir) };
}

describe("tsMoveSymbol — import rewriting", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("updates all importers when multiple files import the moved symbol", async () => {
    const { dir, tsProvider, scope } = setupMultiImporter();
    dirs.push(dir);

    await tsMoveSymbol(
      tsProvider,
      path.join(dir, "src/utils.ts"),
      "add",
      path.join(dir, "src/helpers.ts"),
      scope,
    );

    const featureA = fs.readFileSync(path.join(dir, "src/featureA.ts"), "utf8");
    const featureB = fs.readFileSync(path.join(dir, "src/featureB.ts"), "utf8");
    expect(featureA).toContain('"./helpers.js"');
    expect(featureB).toContain('"./helpers.js"');
    expect(scope.modified).toContain(path.join(dir, "src/featureA.ts"));
    expect(scope.modified).toContain(path.join(dir, "src/featureB.ts"));
  });

  it("removes only the moved specifier when an importer has multiple named imports from the source", async () => {
    const { dir, tsProvider, scope } = setupMultiImporter();
    dirs.push(dir);
    fs.appendFileSync(
      path.join(dir, "src/utils.ts"),
      "\nexport function multiply(a: number, b: number): number { return a * b; }\n",
    );
    fs.writeFileSync(
      path.join(dir, "src/featureA.ts"),
      'import { add, multiply } from "./utils";\nexport const result = add(1, 2) + multiply(3, 4);\n',
    );
    await tsMoveSymbol(
      tsProvider,
      path.join(dir, "src/utils.ts"),
      "add",
      path.join(dir, "src/helpers.ts"),
      scope,
    );
    const content = fs.readFileSync(path.join(dir, "src/featureA.ts"), "utf8");
    expect(content).not.toMatch(/import\s*\{[^}]*add[^}]*\}\s*from\s*["']\.\/utils/);
    expect(content).toMatch(/import\s*\{[^}]*multiply[^}]*\}\s*from\s*["']\.\/utils/);
    expect(content).toMatch(/import\s*\{[^}]*add[^}]*\}\s*from\s*["']\.\/helpers\.js/);
  });

  it("merges with an existing dest import when importer already imports from dest", async () => {
    const { dir, tsProvider, scope } = setupMultiImporter();
    dirs.push(dir);
    const dstPath = path.join(dir, "src/shared.ts");
    fs.writeFileSync(dstPath, "export const PI = 3.14;\n");
    const featureAPath = path.join(dir, "src/featureA.ts");
    fs.writeFileSync(
      featureAPath,
      `import { PI } from "./shared";\n${fs.readFileSync(featureAPath, "utf8")}`,
    );
    await tsMoveSymbol(tsProvider, path.join(dir, "src/utils.ts"), "add", dstPath, scope);
    const importMatches = readFile(dir, "src/featureA.ts").match(
      /import\s*\{[^}]+\}\s*from\s*["']\.\/shared["']/g,
    );
    expect(importMatches).toHaveLength(1);
    expect(importMatches?.[0]).toContain("PI");
    expect(importMatches?.[0]).toContain("add");
  });

  it("merges moved symbol into existing dest import when importer has multiple named imports from source", async () => {
    const { dir, tsProvider, scope } = setupMultiImporter();
    dirs.push(dir);
    fs.appendFileSync(
      path.join(dir, "src/utils.ts"),
      "\nexport function multiply(a: number, b: number): number { return a * b; }\n",
    );
    fs.writeFileSync(path.join(dir, "src/helpers.ts"), "export const PI = 3.14;\n");
    fs.writeFileSync(
      path.join(dir, "src/featureA.ts"),
      'import { add, multiply } from "./utils";\nimport { PI } from "./helpers";\nexport const r = add(1, 2) + multiply(3, 4) + PI;\n',
    );
    await tsMoveSymbol(
      tsProvider,
      path.join(dir, "src/utils.ts"),
      "add",
      path.join(dir, "src/helpers.ts"),
      scope,
    );
    const content = fs.readFileSync(path.join(dir, "src/featureA.ts"), "utf8");
    const helperImports = content.match(/import\s*\{[^}]+\}\s*from\s*["']\.\/helpers/g);
    expect(helperImports).toHaveLength(1);
    expect(helperImports?.[0]).toContain("PI");
    expect(helperImports?.[0]).toContain("add");
    expect(content).toMatch(/import\s*\{[^}]*multiply[^}]*\}\s*from\s*["']\.\/utils/);
  });

  it("does not modify files that import other symbols from source but not the moved symbol", async () => {
    const { dir, tsProvider, scope } = setupSimpleTs();
    dirs.push(dir);
    fs.appendFileSync(
      path.join(dir, "src/utils.ts"),
      "\nexport function multiply(a: number, b: number): number { return a * b; }\n",
    );
    fs.writeFileSync(
      path.join(dir, "src/feature.ts"),
      'import { multiply } from "./utils";\nexport const r = multiply(2, 3);\n',
    );
    await tsMoveSymbol(
      tsProvider,
      path.join(dir, "src/utils.ts"),
      "greetUser",
      path.join(dir, "src/helpers.ts"),
      scope,
    );
    const featureContent = readFile(dir, "src/feature.ts");
    expect(featureContent).not.toContain("helpers");
    expect(featureContent).toContain('"./utils"');
  });

  it("skips updating imports in the dest file when it already imports the symbol from source", async () => {
    const { dir, tsProvider, scope } = setupSimpleTs();
    dirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "src/helpers.ts"),
      'import { greetUser } from "./utils";\nexport function helper(): void { greetUser("x"); }\n',
    );
    await tsMoveSymbol(
      tsProvider,
      path.join(dir, "src/utils.ts"),
      "greetUser",
      path.join(dir, "src/helpers.ts"),
      scope,
    );
    expect(readFile(dir, "src/helpers.ts")).toContain("export function greetUser");
    expect(readFile(dir, "src/helpers.ts")).not.toContain('"./helpers.js"');
    expect(scope.skipped).toHaveLength(0);
  });
});
