import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../__testHelpers__/helpers.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { findImporters } from "./findImporters.js";

describe("findImporters", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = FIXTURES.simpleTs.name) {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  it("returns all files that import the given file", async () => {
    const dir = setup();
    const compiler = new TsMorphEngine();

    const result = await findImporters(compiler, `${dir}/src/utils.ts`);

    expect(result.fileName).toBe("utils.ts");
    expect(result.references.length).toBeGreaterThanOrEqual(1);
    expect(result.references.some((r) => r.file.endsWith("main.ts"))).toBe(true);
    for (const ref of result.references) {
      expect(ref.line).toBeGreaterThan(0);
      expect(ref.col).toBeGreaterThan(0);
      expect(ref.length).toBeGreaterThan(0);
    }
  });

  it("returns empty references for a file with no importers", async () => {
    const dir = setup();
    const compiler = new TsMorphEngine();

    const result = await findImporters(compiler, `${dir}/src/main.ts`);

    expect(result.fileName).toBe("main.ts");
    expect(result.references).toEqual([]);
  });

  it("throws FILE_NOT_FOUND for a non-existent file", async () => {
    const dir = setup();
    const compiler = new TsMorphEngine();

    await expect(findImporters(compiler, `${dir}/src/doesNotExist.ts`)).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
    });
  });
});
