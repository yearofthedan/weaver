import * as fs from "node:fs";
import * as path from "node:path";
import { Project } from "ts-morph";
import { describe, expect } from "vitest";
import { fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { persistSourceFile } from "./persist-source-file.js";

const BOM_BYTES = Buffer.from([0xef, 0xbb, 0xbf]);

function makeScope(root: string): WorkspaceScope {
  return new WorkspaceScope(root, new NodeFileSystem());
}

describe("persistSourceFile", () => {
  test("writes the source file's current text to disk", async ({ dir }) => {
    const filePath = path.join(dir, "a.ts");
    fs.writeFileSync(filePath, "export const a = 1;\n", "utf8");
    const project = new Project({ useInMemoryFileSystem: false });
    const sf = project.addSourceFileAtPath(filePath);
    sf.replaceWithText("export const a = 2;\n");
    const scope = makeScope(dir);

    persistSourceFile(sf, scope);

    expect(fs.readFileSync(filePath, "utf8")).toBe("export const a = 2;\n");
  });

  test("records the file as modified on the scope", async ({ dir }) => {
    const filePath = path.join(dir, "a.ts");
    fs.writeFileSync(filePath, "export const a = 1;\n", "utf8");
    const project = new Project({ useInMemoryFileSystem: false });
    const sf = project.addSourceFileAtPath(filePath);
    const scope = makeScope(dir);

    persistSourceFile(sf, scope);

    expect(scope.modified).toContain(filePath);
    expect(scope.skipped).not.toContain(filePath);
  });

  test("preserves a leading byte-order mark present in the file on disk", async ({ dir }) => {
    const filePath = path.join(dir, "b.ts");
    fs.writeFileSync(
      filePath,
      Buffer.concat([BOM_BYTES, Buffer.from("export const b = 1;\n", "utf8")]),
    );
    const project = new Project({ useInMemoryFileSystem: false });
    const sf = project.addSourceFileAtPath(filePath);
    sf.replaceWithText("export const b = 2;\n");
    const scope = makeScope(dir);

    persistSourceFile(sf, scope);

    const bytes = fs.readFileSync(filePath);
    expect(bytes.subarray(0, 3)).toEqual(BOM_BYTES);
    expect(bytes.toString("utf8")).toBe("﻿export const b = 2;\n");
  });

  test("does not add a byte-order mark to a file that never had one", async ({ dir }) => {
    const filePath = path.join(dir, "c.ts");
    fs.writeFileSync(filePath, "export const c = 1;\n", "utf8");
    const project = new Project({ useInMemoryFileSystem: false });
    const sf = project.addSourceFileAtPath(filePath);
    sf.replaceWithText("export const c = 2;\n");
    const scope = makeScope(dir);

    persistSourceFile(sf, scope);

    const bytes = fs.readFileSync(filePath);
    expect(bytes.subarray(0, 3)).not.toEqual(BOM_BYTES);
  });

  test("treats a source file with no file on disk yet as having no byte-order mark", async ({
    dir,
  }) => {
    const filePath = path.join(dir, "d.ts");
    const project = new Project({ useInMemoryFileSystem: false });
    const sf = project.createSourceFile(filePath, "export const d = 1;\n");
    const scope = makeScope(dir);

    persistSourceFile(sf, scope);

    const bytes = fs.readFileSync(filePath);
    expect(bytes.subarray(0, 3)).not.toEqual(BOM_BYTES);
    expect(bytes.toString("utf8")).toBe("export const d = 1;\n");
  });
});
