import * as path from "node:path";
import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { dispatchRequest } from "./dispatcher.js";

describe("dispatchRequest getTypeErrors engine routing in a Vue project", () => {
  test("single-file call on a .vue file returns that file's diagnostics instead of throwing", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
    const file = path.join(dir, "src/Broken.vue");

    const result = (await dispatchRequest(
      { method: "getTypeErrors", params: { file } },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    const diagnostics = result.diagnostics as Array<{ file: string; code: number }>;
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.file === file)).toBe(true);
    expect(result.errorCount).toBe(diagnostics.length);
  }, 15_000);

  test("single-file call on a .ts file in the same Vue project also routes through VolarEngine without throwing", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
    const file = path.join(dir, "src/utils.ts");

    const result = (await dispatchRequest(
      { method: "getTypeErrors", params: { file } },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    const diagnostics = result.diagnostics as Array<{ file: string; code: number }>;
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.file === file)).toBe(true);
  }, 15_000);

  test("project-wide call (no file param) includes diagnostics from both .ts and .vue files", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.vueErrors.name);

    const result = (await dispatchRequest({ method: "getTypeErrors", params: {} }, dir)) as Record<
      string,
      unknown
    >;

    expect(result.status).toBe("success");
    const diagnostics = result.diagnostics as Array<{ file: string }>;
    expect(diagnostics.some((d) => d.file.endsWith(".ts"))).toBe(true);
    expect(diagnostics.some((d) => d.file.endsWith(".vue"))).toBe(true);
    expect(result.errorCount).toBe(diagnostics.length);
  }, 15_000);

  test("project-wide call on a non-Vue project is unaffected — same diagnostics as before the fix", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);

    const result = (await dispatchRequest({ method: "getTypeErrors", params: {} }, dir)) as Record<
      string,
      unknown
    >;

    expect(result.status).toBe("success");
    const diagnostics = result.diagnostics as Array<{ file: string }>;
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.file.endsWith(".ts"))).toBe(true);
    expect(diagnostics.every((d) => !d.file.endsWith(".vue"))).toBe(true);
  }, 15_000);

  test("single-file call resolves the tsconfig nearest the given file, not the workspace root's", async ({
    seedInlineFixture,
  }) => {
    // Workspace root has a plain TS-only tsconfig with no .vue awareness; the requested
    // file lives in a nested project with its own tsconfig that does include .vue files.
    // Routing off the file (not the workspace root) is what selects VolarEngine here.
    const dir = await seedInlineFixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true },
        include: ["outer.ts"],
      }),
      "outer.ts": "export const outer: string = 'hello';\n",
      "sub/tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
        },
        include: ["**/*.ts", "**/*.vue"],
      }),
      "sub/Broken.vue":
        '<script setup lang="ts">\nconst x: number = "hello";\n</script>\n<template><div>{{ x }}</div></template>\n',
    });
    const file = path.join(dir, "sub/Broken.vue");

    const result = (await dispatchRequest(
      { method: "getTypeErrors", params: { file } },
      dir,
    )) as Record<string, unknown>;

    expect(result.status).toBe("success");
    const diagnostics = result.diagnostics as Array<{ file: string; code: number }>;
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.file === file)).toBe(true);
  }, 15_000);
});
