import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { moveSymbol } from "../../src/operations/moveSymbol.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";
import { TsProvider } from "../../src/providers/ts.js";
import { cleanup, copyFixture, readFile } from "../helpers.js";

describe("moveSymbol operation — TsProvider integration", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("moves a symbol end-to-end: source updated, dest created, importer updated", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    const tsProvider = new TsProvider();
    const scope = new WorkspaceScope(dir, new NodeFileSystem());

    const result = await moveSymbol(
      tsProvider,
      tsProvider,
      `${dir}/src/utils.ts`,
      "greetUser",
      `${dir}/src/helpers.ts`,
      scope,
    );

    expect(result.symbolName).toBe("greetUser");
    expect(result.sourceFile).toBe(`${dir}/src/utils.ts`);
    expect(result.destFile).toBe(`${dir}/src/helpers.ts`);
    expect(readFile(dir, "src/helpers.ts")).toContain("greetUser");
    expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
    expect(readFile(dir, "src/main.ts")).toContain('"./helpers.js"');
    expect(readFile(dir, "src/main.ts")).not.toContain('"./utils"');
    expect(result.filesModified).toContain(`${dir}/src/utils.ts`);
    expect(result.filesModified).toContain(`${dir}/src/helpers.ts`);
  });

  it("filesSkipped includes importers outside the workspace boundary when inside the ts project", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-movesymbol-int-boundary-"));
    dirs.push(tmpDir);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "lib"), { recursive: true });
    // tsconfig includes all TS files so ts-morph sees the lib/consumer.ts importer
    fs.writeFileSync(
      path.join(tmpDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true }, include: ["**/*.ts"] }),
    );
    fs.writeFileSync(
      path.join(tmpDir, "src/utils.ts"),
      "export function add(a: number, b: number): number { return a + b; }\n",
    );
    fs.writeFileSync(
      path.join(tmpDir, "lib/consumer.ts"),
      'import { add } from "../src/utils";\nexport const result = add(1, 2);\n',
    );
    // Workspace is scoped to src/ only — lib/ is outside the boundary
    const scope = new WorkspaceScope(path.join(tmpDir, "src"), new NodeFileSystem());
    const tsProvider = new TsProvider();

    const result = await moveSymbol(
      tsProvider,
      tsProvider,
      path.join(tmpDir, "src/utils.ts"),
      "add",
      path.join(tmpDir, "src/helpers.ts"),
      scope,
    );

    expect(result.filesSkipped.some((f) => f.includes("consumer.ts"))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "lib/consumer.ts"), "utf8")).toContain("../src/utils");
  });

  it("afterSymbolMove fallback rewrites out-of-project test file imports end-to-end", async () => {
    // simple-ts fixture: tsconfig.include = ["src/**/*.ts"], so tests/ is outside the project.
    // tests/utils.test.ts imports greetUser from "../src/utils".
    // After moving greetUser to src/helpers.ts, the fallback scan must rewrite the test file.
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    const tsProvider = new TsProvider();
    const scope = new WorkspaceScope(dir, new NodeFileSystem());

    const result = await moveSymbol(
      tsProvider,
      tsProvider,
      `${dir}/src/utils.ts`,
      "greetUser",
      `${dir}/src/helpers.ts`,
      scope,
    );

    const testContent = fs.readFileSync(path.join(dir, "tests/utils.test.ts"), "utf8");
    expect(testContent).toContain("../src/helpers.js");
    expect(testContent).not.toContain("../src/utils");
    expect(result.filesModified).toContain(path.join(dir, "tests/utils.test.ts"));
  });
});
