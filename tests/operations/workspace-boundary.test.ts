import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { moveFile } from "../../src/operations/moveFile.js";
import { rename } from "../../src/operations/rename.js";
import { TsProvider } from "../../src/providers/ts.js";
import { cleanup, copyFixture, readFile } from "../helpers.js";

describe("workspace boundary enforcement", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) cleanup(dir);
  });

  it("rename: skips out-of-workspace impacted files, writes in-workspace files", async () => {
    const root = copyFixture("cross-boundary");
    dirs.push(root);

    const workspace = path.join(root, "workspace");
    const utilsFile = path.join(workspace, "src/utils.ts");
    const _consumerFile = path.join(root, "consumer/main.ts");

    const before = {
      utils: readFile(root, "workspace/src/utils.ts"),
      consumer: readFile(root, "consumer/main.ts"),
    };
    expect(before.utils).toContain("greetUser");
    expect(before.consumer).toContain("greetUser");

    const provider = new TsProvider();
    // greetUser starts at col 17: "export function greetUser"
    //                                               ^ col 17
    const result = await rename(provider, utilsFile, 1, 17, "greetPerson", workspace);

    // In-workspace file updated
    expect(result.filesModified.some((f) => f.includes("utils.ts"))).toBe(true);
    expect(readFile(root, "workspace/src/utils.ts")).toContain("greetPerson");
    expect(readFile(root, "workspace/src/utils.ts")).not.toContain("greetUser");

    // Out-of-workspace file skipped — content unchanged on disk
    expect(result.filesSkipped.some((f) => f.includes("consumer"))).toBe(true);
    expect(readFile(root, "consumer/main.ts")).toContain("greetUser");
    expect(readFile(root, "consumer/main.ts")).not.toContain("greetPerson");
  }, 30_000);

  it("moveFile: skips out-of-workspace import rewrites, performs the physical move", async () => {
    const root = copyFixture("cross-boundary");
    dirs.push(root);

    const workspace = path.join(root, "workspace");
    const oldFilePath = path.join(workspace, "src/utils.ts");
    const newFilePath = path.join(workspace, "src/helpers.ts");
    const _consumerFile = path.join(root, "consumer/main.ts");

    expect(fs.existsSync(oldFilePath)).toBe(true);
    expect(readFile(root, "consumer/main.ts")).toContain("utils");

    const provider = new TsProvider();
    const result = await moveFile(provider, oldFilePath, newFilePath, workspace);

    // Physical move happened
    expect(fs.existsSync(oldFilePath)).toBe(false);
    expect(fs.existsSync(newFilePath)).toBe(true);

    // Moved file listed as modified
    expect(result.filesModified.some((f) => f.includes("helpers.ts"))).toBe(true);

    // Out-of-workspace consumer import NOT rewritten
    expect(result.filesSkipped.some((f) => f.includes("consumer"))).toBe(true);
    expect(readFile(root, "consumer/main.ts")).toContain("utils");
    expect(readFile(root, "consumer/main.ts")).not.toContain("helpers");
  }, 30_000);
});
