import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { dispatchRequest } from "./dispatcher.js";

describe("dispatchRequest post-write diagnostics (checkTypeErrors)", () => {
  test("returns typeErrors fields by default when files are modified", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function multiply",
          replacement: "// comment\nexport function multiply",
          glob: "**/clean.ts",
        },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    expect((result.filesModified as string[]).length).toBeGreaterThan(0);
    expect(result).toHaveProperty("typeErrors");
    expect(result).toHaveProperty("typeErrorCount");
    expect(result).toHaveProperty("typeErrorsTruncated");
  }, 15_000);

  test("checkTypeErrors:false suppresses typeErrors even when files are modified", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function multiply",
          replacement: "// comment\nexport function multiply",
          glob: "**/clean.ts",
          checkTypeErrors: false,
        },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    expect((result.filesModified as string[]).length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("typeErrors");
    expect(result).not.toHaveProperty("typeErrorCount");
    expect(result).not.toHaveProperty("typeErrorsTruncated");
  }, 15_000);

  test("produces no typeErrors fields when no files are modified", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: { pattern: "__no_match_xyz__", replacement: "x" },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    expect((result.filesModified as string[]).length).toBe(0);
    expect(result).not.toHaveProperty("typeErrors");
    expect(result).not.toHaveProperty("typeErrorCount");
    expect(result).not.toHaveProperty("typeErrorsTruncated");
  }, 15_000);

  test("type errors introduced by a write are returned", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function multiply",
          replacement: "const _bad: string = 123;\nexport function multiply",
          glob: "**/clean.ts",
        },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("warn");
    expect(result).toHaveProperty("typeErrors");
    expect(result).toHaveProperty("typeErrorCount");
    expect(result).toHaveProperty("typeErrorsTruncated");

    const typeErrors = result.typeErrors as Array<{
      file: string;
      line: number;
      col: number;
      code: number;
      message: string;
    }>;
    expect(typeErrors.length).toBeGreaterThanOrEqual(1);
    expect(result.typeErrorCount as number).toBeGreaterThanOrEqual(1);
    expect(typeErrors.every((d) => d.file.endsWith("clean.ts"))).toBe(true);
    for (const d of typeErrors) {
      expect(d.line).toBeGreaterThan(0);
      expect(d.col).toBeGreaterThan(0);
      expect(typeof d.code).toBe("number");
      expect(d.code).toBeGreaterThan(0);
      expect(d.message.length).toBeGreaterThan(0);
    }
  }, 15_000);

  test("errors in unmodified files are excluded from typeErrors", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function multiply",
          replacement: "// type-safe\nexport function multiply",
          glob: "**/clean.ts",
        },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    expect(result.typeErrorCount).toBe(0);
    const typeErrors = result.typeErrors as Array<{ file: string }>;
    expect(typeErrors.every((d) => d.file.endsWith("clean.ts"))).toBe(true);
  }, 15_000);

  test("clean modified files produce an empty typeErrors array", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const result = (await dispatchRequest(
      {
        method: "replaceText",
        params: {
          pattern: "export function multiply",
          replacement: "// type-safe\nexport function multiply",
          glob: "**/clean.ts",
        },
      },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    expect(result).toHaveProperty("filesModified");
    expect(result).toHaveProperty("typeErrors");
    expect(result).toHaveProperty("typeErrorCount");
    expect(result).toHaveProperty("typeErrorsTruncated");
    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    expect(result.typeErrorsTruncated).toBe(false);
  }, 15_000);
});
