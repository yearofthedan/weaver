import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { copyFixture, FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "./engine.js";
import { tsMoveSymbol } from "./move-symbol.js";

function makeScope(root: string): WorkspaceScope {
  return new WorkspaceScope(root, new NodeFileSystem());
}

describe("tsMoveSymbol — error cases and conflict detection", () => {
  describe("symbol not found", () => {
    test("throws SYMBOL_NOT_FOUND for an unknown symbol", async ({ dir, seedNamedFixture }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const tsCompiler = new TsMorphEngine();
      const scope = makeScope(dir);
      await expect(
        tsMoveSymbol(
          tsCompiler,
          path.join(dir, "src/utils.ts"),
          "doesNotExist",
          path.join(dir, "src/helpers.ts"),
          scope,
        ),
      ).rejects.toMatchObject({ code: "SYMBOL_NOT_FOUND" });
    });

    test("throws NOT_SUPPORTED for a symbol re-exported via 'export { }'", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const tsCompiler = new TsMorphEngine();
      const scope = makeScope(dir);
      fs.writeFileSync(
        path.join(dir, "src/reexport.ts"),
        "const localFn = (): number => 42;\nexport { localFn };\n",
      );
      await expect(
        tsMoveSymbol(
          tsCompiler,
          path.join(dir, "src/reexport.ts"),
          "localFn",
          path.join(dir, "src/helpers.ts"),
          scope,
        ),
      ).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    });
  });

  describe("SYMBOL_EXISTS — conflict detection", () => {
    test("throws SYMBOL_EXISTS when dest already exports the symbol and force is not set", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const tsCompiler = new TsMorphEngine();
      const scope = makeScope(dir);
      fs.writeFileSync(path.join(dir, "src/helpers.ts"), "export function greetUser(): void {}\n");
      await expect(
        tsMoveSymbol(
          tsCompiler,
          path.join(dir, "src/utils.ts"),
          "greetUser",
          path.join(dir, "src/helpers.ts"),
          scope,
        ),
      ).rejects.toMatchObject({ code: "SYMBOL_EXISTS" });
    });

    test("throws SYMBOL_EXISTS with a message naming the symbol and dest file", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const tsCompiler = new TsMorphEngine();
      const scope = makeScope(dir);
      fs.writeFileSync(path.join(dir, "src/b.ts"), "export const FOO = 42;\n");
      fs.writeFileSync(path.join(dir, "src/a.ts"), "export const FOO = 1;\n");
      await expect(
        tsMoveSymbol(
          tsCompiler,
          path.join(dir, "src/a.ts"),
          "FOO",
          path.join(dir, "src/b.ts"),
          scope,
        ),
      ).rejects.toMatchObject({ code: "SYMBOL_EXISTS", message: expect.stringMatching(/FOO/) });
    });

    it.each([
      ["a function", "export function FOO(): void {}"],
      ["a class", "export class FOO {}"],
    ])("throws SYMBOL_EXISTS when dest exports %s with the same name", async (_label, decl) => {
      // Re-create the context for this test since it's parameterized
      const dir = copyFixture(FIXTURES.simpleTs.name);
      try {
        const tsCompiler = new TsMorphEngine();
        const scope = makeScope(dir);
        fs.writeFileSync(path.join(dir, "src/a.ts"), "export const FOO = 1;\n");
        fs.writeFileSync(path.join(dir, "src/b.ts"), `${decl}\n`);
        await expect(
          tsMoveSymbol(
            tsCompiler,
            path.join(dir, "src/a.ts"),
            "FOO",
            path.join(dir, "src/b.ts"),
            scope,
          ),
        ).rejects.toMatchObject({ code: "SYMBOL_EXISTS" });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it.each([
      ["source", path.join("src", "a.ts"), "export const FOO = 1;\n"],
      ["destination", path.join("src", "b.ts"), "export const FOO = 42;\n"],
    ] as const)("leaves the %s file unmodified when SYMBOL_EXISTS is thrown", async (_label, relPath, expectedContent) => {
      // Re-create the context for this test since it's parameterized
      const dir = copyFixture(FIXTURES.simpleTs.name);
      try {
        const tsCompiler = new TsMorphEngine();
        const scope = makeScope(dir);
        fs.writeFileSync(path.join(dir, "src/a.ts"), "export const FOO = 1;\n");
        fs.writeFileSync(path.join(dir, "src/b.ts"), "export const FOO = 42;\n");
        await expect(
          tsMoveSymbol(
            tsCompiler,
            path.join(dir, "src/a.ts"),
            "FOO",
            path.join(dir, "src/b.ts"),
            scope,
          ),
        ).rejects.toMatchObject({ code: "SYMBOL_EXISTS" });
        expect(fs.readFileSync(path.join(dir, relPath), "utf8")).toBe(expectedContent);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test("does not rewrite importers when SYMBOL_EXISTS is thrown", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const tsCompiler = new TsMorphEngine();
      const scope = makeScope(dir);
      fs.writeFileSync(path.join(dir, "src/a.ts"), "export const FOO = 1;\n");
      fs.writeFileSync(path.join(dir, "src/b.ts"), "export const FOO = 42;\n");
      const importerContent = 'import { FOO } from "./a";\nexport const x = FOO;\n';
      fs.writeFileSync(path.join(dir, "src/importer.ts"), importerContent);
      await expect(
        tsMoveSymbol(
          tsCompiler,
          path.join(dir, "src/a.ts"),
          "FOO",
          path.join(dir, "src/b.ts"),
          scope,
        ),
      ).rejects.toMatchObject({ code: "SYMBOL_EXISTS" });
      expect(fs.readFileSync(path.join(dir, "src/importer.ts"), "utf8")).toBe(importerContent);
    });

    test("throws SYMBOL_EXISTS when dest has a non-exported same-name declaration", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const tsCompiler = new TsMorphEngine();
      const scope = makeScope(dir);
      fs.writeFileSync(path.join(dir, "src/a.ts"), "export const FOO = 1;\n");
      fs.writeFileSync(path.join(dir, "src/b.ts"), "const FOO = 42;\n");
      await expect(
        tsMoveSymbol(
          tsCompiler,
          path.join(dir, "src/a.ts"),
          "FOO",
          path.join(dir, "src/b.ts"),
          scope,
        ),
      ).rejects.toMatchObject({ code: "SYMBOL_EXISTS" });
    });
  });

  describe("force flag — source replaces dest declaration", () => {
    test("source declaration replaces dest declaration when force is true and conflict exists", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      fs.writeFileSync(path.join(dir, "src/a.ts"), "export const FOO = 1;\n");
      fs.writeFileSync(path.join(dir, "src/b.ts"), "export const FOO = 42;\n");
      const tsCompiler = new TsMorphEngine();
      const scope = makeScope(dir);
      fs.writeFileSync(
        path.join(dir, "src/c.ts"),
        'import { FOO } from "./a";\nexport const x = FOO;\n',
      );
      await tsMoveSymbol(
        tsCompiler,
        path.join(dir, "src/a.ts"),
        "FOO",
        path.join(dir, "src/b.ts"),
        scope,
        { force: true },
      );
      expect(fs.readFileSync(path.join(dir, "src/a.ts"), "utf8")).not.toContain("FOO");
      const bContent = fs.readFileSync(path.join(dir, "src/b.ts"), "utf8");
      expect(bContent).toBe("export const FOO = 1;\n");
      expect(bContent).not.toContain("FOO = 42");
      expect(fs.readFileSync(path.join(dir, "src/c.ts"), "utf8")).toContain('"./b.js"');
      expect(scope.modified).toContain(path.join(dir, "src/a.ts"));
      expect(scope.modified).toContain(path.join(dir, "src/b.ts"));
      expect(scope.modified).toContain(path.join(dir, "src/c.ts"));
    });

    test("dest file is included in modified when force replaces the existing declaration", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      fs.writeFileSync(path.join(dir, "src/a.ts"), "export const FOO = 1;\n");
      fs.writeFileSync(path.join(dir, "src/b.ts"), "export const FOO = 42;\n");
      const tsCompiler = new TsMorphEngine();
      const scope = makeScope(dir);
      await tsMoveSymbol(
        tsCompiler,
        path.join(dir, "src/a.ts"),
        "FOO",
        path.join(dir, "src/b.ts"),
        scope,
        { force: true },
      );
      expect(scope.modified).toContain(path.join(dir, "src/b.ts"));
      expect(fs.readFileSync(path.join(dir, "src/b.ts"), "utf8")).toContain("FOO = 1");
    });

    test("force false with conflict throws SYMBOL_EXISTS — same as omitted", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      fs.writeFileSync(path.join(dir, "src/a.ts"), "export const FOO = 1;\n");
      fs.writeFileSync(path.join(dir, "src/b.ts"), "export const FOO = 42;\n");
      const tsCompiler = new TsMorphEngine();
      const scope = makeScope(dir);
      await expect(
        tsMoveSymbol(
          tsCompiler,
          path.join(dir, "src/a.ts"),
          "FOO",
          path.join(dir, "src/b.ts"),
          scope,
          { force: false },
        ),
      ).rejects.toMatchObject({ code: "SYMBOL_EXISTS" });
    });

    test("source const replaces a function declaration of the same name in dest when force is true", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      fs.writeFileSync(path.join(dir, "src/a.ts"), "export const FOO = 1;\n");
      fs.writeFileSync(path.join(dir, "src/b.ts"), "export function FOO(): void {}\n");
      await tsMoveSymbol(
        new TsMorphEngine(),
        path.join(dir, "src/a.ts"),
        "FOO",
        path.join(dir, "src/b.ts"),
        makeScope(dir),
        { force: true },
      );
      const bContent = fs.readFileSync(path.join(dir, "src/b.ts"), "utf8");
      expect(bContent).toContain("export const FOO = 1");
      expect(bContent).not.toContain("function FOO");
    });
  });
});
