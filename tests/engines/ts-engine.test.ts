import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TsEngine } from "../../src/engines/ts/engine";
import { cleanup, copyFixture, readFile } from "../helpers";

describe("TsEngine (moveSymbol)", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = "simple-ts") {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  it("moves a function to a new file", async () => {
    const dir = setup();
    const engine = new TsEngine();

    const srcPath = `${dir}/src/utils.ts`;
    const dstPath = `${dir}/src/helpers.ts`;

    const result = await engine.moveSymbol(srcPath, "greetUser", dstPath, dir);

    expect(result.symbolName).toBe("greetUser");
    expect(result.sourceFile).toBe(srcPath);
    expect(result.destFile).toBe(dstPath);

    expect(readFile(dir, "src/helpers.ts")).toContain("greetUser");
    expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
  });

  it("moves a function to an existing file", async () => {
    const dir = setup();
    fs.writeFileSync(
      path.join(dir, "src/helpers.ts"),
      'export function helper(): string { return "hi"; }\n',
    );
    const engine = new TsEngine();

    await engine.moveSymbol(`${dir}/src/utils.ts`, "greetUser", `${dir}/src/helpers.ts`, dir);

    const destContent = readFile(dir, "src/helpers.ts");
    expect(destContent).toContain("helper");
    expect(destContent).toContain("greetUser");
  });

  it("updates the import in the importing file", async () => {
    const dir = setup();
    const engine = new TsEngine();

    await engine.moveSymbol(`${dir}/src/utils.ts`, "greetUser", `${dir}/src/helpers.ts`, dir);

    const mainContent = readFile(dir, "src/main.ts");
    expect(mainContent).toContain("./helpers");
    expect(mainContent).not.toContain("./utils");
  });

  it("merges with an existing dest import when the importer already imports from dest", async () => {
    const dir = setup("multi-importer");
    const dstPath = `${dir}/src/shared.ts`;
    fs.writeFileSync(dstPath, "export const PI = 3.14;\n");
    const featureAPath = path.join(dir, "src/featureA.ts");
    const originalA = fs.readFileSync(featureAPath, "utf8");
    fs.writeFileSync(featureAPath, `import { PI } from "./shared";\n${originalA}`);

    const engine = new TsEngine();
    await engine.moveSymbol(`${dir}/src/utils.ts`, "add", dstPath, dir);

    const featureAContent = readFile(dir, "src/featureA.ts");
    const importMatches = featureAContent.match(/import\s*\{[^}]+\}\s*from\s*["']\.\/shared["']/g);
    expect(importMatches).toHaveLength(1);
    expect(importMatches?.[0]).toContain("PI");
    expect(importMatches?.[0]).toContain("add");
  });

  it("symbol is absent from source file after move", async () => {
    const dir = setup();
    const engine = new TsEngine();

    await engine.moveSymbol(`${dir}/src/utils.ts`, "greetUser", `${dir}/src/helpers.ts`, dir);

    expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
  });

  it("throws SYMBOL_NOT_FOUND for an unknown symbol", async () => {
    const dir = setup();
    const engine = new TsEngine();

    try {
      await engine.moveSymbol(`${dir}/src/utils.ts`, "doesNotExist", `${dir}/src/helpers.ts`, dir);
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe("SYMBOL_NOT_FOUND");
    }
  });

  it("throws FILE_NOT_FOUND for a missing source file", async () => {
    const dir = setup();
    const engine = new TsEngine();

    try {
      await engine.moveSymbol(
        `${dir}/src/doesNotExist.ts`,
        "greetUser",
        `${dir}/src/helpers.ts`,
        dir,
      );
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect((err as { code?: string }).code).toBe("FILE_NOT_FOUND");
    }
  });
});
