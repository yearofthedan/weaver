import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "./engine.js";
import { tsRemoveImportersOf } from "./remove-importers.js";

function makeScope(workspace: string): WorkspaceScope {
  return new WorkspaceScope(workspace, new NodeFileSystem());
}

/**
 * Creates a minimal temporary workspace with a tsconfig.json and any given files.
 * Returns the workspace directory path.
 */
function makeWorkspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-remove-importers-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });

  if (!files["tsconfig.json"]) {
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }),
      "utf8",
    );
  }

  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.join(dir, rel);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }

  return dir;
}

describe("tsRemoveImportersOf", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  describe("adding source file not yet in project", () => {
    it("handles target file that is not covered by the tsconfig include pattern", async () => {
      // Create a workspace where target.ts is placed outside the tsconfig include path.
      // The tsconfig only covers src/**/*.ts, so a file at tests/target.ts is NOT
      // automatically included. The guard at line 37 of remove-importers.ts must call
      // addSourceFileAtPath so the project can resolve module specifiers for target.ts.
      const dir = makeWorkspace({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true },
          include: ["src/**/*.ts"],
        }),
        "src/importer.ts":
          'import { targetFn } from "../tests/target";\nexport const y = targetFn();\n',
        "tests/target.ts": "export function targetFn(): string { return 'target'; }\n",
      });
      dirs.push(dir);

      // The target is in tests/ which is NOT in tsconfig include — not auto-loaded.
      const targetFile = path.join(dir, "tests", "target.ts");
      const scope = makeScope(dir);
      const engine = new TsMorphEngine();

      // Without addSourceFileAtPath, the project cannot resolve `../tests/target`,
      // so no declarations would be removed. With it, importer.ts is cleaned up.
      const removed = await tsRemoveImportersOf(engine, targetFile, scope);

      expect(removed).toBeGreaterThan(0);
      expect(scope.modified).toContain(path.join(dir, "src", "importer.ts"));
    });
  });

  describe("skipping the target file itself", () => {
    it("does not process the target file even when it has a self-referential re-export", async () => {
      // TypeScript allows `export * from './target'` inside target.ts itself (circular).
      // Without the `if (filePath === targetFile) continue` guard, target.ts would be
      // processed as an importer of itself — its self-re-export would be detected as a
      // reference and removed, causing target.ts to appear in scope.modified.
      const dir = makeWorkspace({
        // target.ts exports * from itself — a circular re-export that TypeScript permits.
        "src/target.ts": "export * from './target';\nexport const x = 1;\n",
        "src/importer.ts": 'import { x } from "./target";\nexport const y = x;\n',
      });
      dirs.push(dir);

      const targetFile = path.join(dir, "src", "target.ts");
      const scope = makeScope(dir);
      const engine = new TsMorphEngine();

      const removed = await tsRemoveImportersOf(engine, targetFile, scope);

      // importer.ts references target (the deleted file) — it must be processed.
      expect(scope.modified).toContain(path.join(dir, "src", "importer.ts"));
      // target.ts itself must NOT appear in modified — it is the target, not an importer.
      // Without the guard, the circular re-export would cause target.ts to be processed
      // and incorrectly appear in modified.
      expect(scope.modified).not.toContain(targetFile);
      // Only the import in importer.ts is removed; target.ts is not processed.
      expect(removed).toBe(1);
    });
  });

  describe("optional chaining on unresolvable module specifiers", () => {
    it("does not throw when a file imports from an external package that cannot be resolved", async () => {
      const dir = makeWorkspace({
        "src/target.ts": "export const x = 1;\n",
        "src/consumer.ts": [
          'import { x } from "./target";',
          'import { something } from "some-external-package-that-does-not-exist";',
          "export const y = x;\n",
        ].join("\n"),
      });
      dirs.push(dir);

      const targetFile = path.join(dir, "src", "target.ts");
      const scope = makeScope(dir);
      const engine = new TsMorphEngine();

      // This should not throw even though the external package's source file
      // cannot be resolved (getModuleSpecifierSourceFile() returns undefined).
      const removed = await tsRemoveImportersOf(engine, targetFile, scope);

      const consumerContent = fs.readFileSync(path.join(dir, "src", "consumer.ts"), "utf8");
      // The import from target should be removed.
      expect(consumerContent).not.toMatch(/from ['"]\.\/target['"]/);
      // The external import should remain untouched.
      expect(consumerContent).toMatch(/some-external-package-that-does-not-exist/);
      // The count reflects only the target import being removed, not the external one.
      expect(removed).toBe(1);
    });
  });

  describe("predicate filters only target-file declarations", () => {
    it("removes only the import referencing the target file, leaving unrelated imports intact", async () => {
      const dir = copyFixture(FIXTURES.multiImporter.name);
      dirs.push(dir);

      // Add a file that imports from both utils.ts (target) and featureA.ts (unrelated).
      const bothImporter = path.join(dir, "src", "combined.ts");
      fs.writeFileSync(
        bothImporter,
        'import { add } from "./utils";\nimport { sumA } from "./featureA";\nexport const result = add(sumA, 1);\n',
        "utf8",
      );

      const targetFile = path.join(dir, "src", "utils.ts");
      const scope = makeScope(dir);
      const engine = new TsMorphEngine();

      const removed = await tsRemoveImportersOf(engine, targetFile, scope);

      const content = fs.readFileSync(bothImporter, "utf8");
      // Import from utils (the target) must be gone.
      expect(content).not.toMatch(/from ['"]\.\/utils['"]/);
      // Import from featureA (unrelated) must remain.
      expect(content).toMatch(/from ['"]\.\/featureA['"]/);
      expect(removed).toBeGreaterThan(0);
    });

    it("counts each removed declaration individually when multiple files import the target", async () => {
      const dir = copyFixture(FIXTURES.multiImporter.name);
      dirs.push(dir);

      const targetFile = path.join(dir, "src", "utils.ts");
      const scope = makeScope(dir);
      const engine = new TsMorphEngine();

      const removed = await tsRemoveImportersOf(engine, targetFile, scope);

      // featureA.ts and featureB.ts each have one import declaration for utils.ts.
      expect(removed).toBe(2);
      expect(scope.modified).toContain(path.join(dir, "src", "featureA.ts"));
      expect(scope.modified).toContain(path.join(dir, "src", "featureB.ts"));
    });
  });

  describe("scope boundary enforcement during save", () => {
    it("does not save files outside the workspace scope boundary", async () => {
      const root = copyFixture(FIXTURES.crossBoundary.name);
      dirs.push(root);

      const workspace = path.join(root, "workspace");
      const targetFile = path.join(workspace, "src", "utils.ts");
      const consumerFile = path.join(root, "consumer", "main.ts");

      // Record the consumer file content before the operation.
      const consumerBefore = fs.readFileSync(consumerFile, "utf8");

      // Use a scope limited to workspace/ — consumer/ is outside it.
      const scope = makeScope(workspace);
      await tsRemoveImportersOf(new TsMorphEngine(), targetFile, scope);

      // Consumer file must not have been written — it is outside the scope boundary.
      expect(fs.readFileSync(consumerFile, "utf8")).toBe(consumerBefore);
      // Consumer is recorded as skipped, not modified.
      expect(scope.skipped).toContain(consumerFile);
      expect(scope.modified).not.toContain(consumerFile);
    });

    it("saves only in-scope dirty files, not out-of-scope ones", async () => {
      const dir = copyFixture(FIXTURES.deleteFileTs.name);
      dirs.push(dir);

      // Create an extra importer file that will be modified.
      const extraFile = path.join(dir, "src", "extra.ts");
      fs.writeFileSync(
        extraFile,
        'import { targetFn } from "./target";\nexport const z = targetFn();\n',
        "utf8",
      );

      const targetFile = path.join(dir, "src", "target.ts");
      const scope = makeScope(dir);
      const engine = new TsMorphEngine();

      await tsRemoveImportersOf(engine, targetFile, scope);

      // The extra file was inside the workspace scope and should have been saved.
      const extraContent = fs.readFileSync(extraFile, "utf8");
      expect(extraContent).not.toMatch(/from ['"]\.\/target['"]/);
      expect(scope.modified).toContain(extraFile);
    });
  });

  describe("export declarations that reference the target", () => {
    it("removes export declarations (re-exports) that reference the deleted file", async () => {
      const dir = copyFixture(FIXTURES.deleteFileTs.name);
      dirs.push(dir);

      const targetFile = path.join(dir, "src", "target.ts");
      const scope = makeScope(dir);
      const engine = new TsMorphEngine();

      await tsRemoveImportersOf(engine, targetFile, scope);

      const barrelContent = fs.readFileSync(path.join(dir, "src", "barrel.ts"), "utf8");
      expect(barrelContent).not.toMatch(/from ['"]\.\/target['"]/);
      expect(scope.modified).toContain(path.join(dir, "src", "barrel.ts"));
    });
  });

  describe("return value", () => {
    it("returns 0 when no files import the target", async () => {
      const dir = makeWorkspace({
        "src/isolated.ts": "export const x = 1;\n",
      });
      dirs.push(dir);

      const targetFile = path.join(dir, "src", "isolated.ts");
      const scope = makeScope(dir);
      const engine = new TsMorphEngine();

      const removed = await tsRemoveImportersOf(engine, targetFile, scope);

      expect(removed).toBe(0);
      expect(scope.modified).toHaveLength(0);
    });
  });
});
