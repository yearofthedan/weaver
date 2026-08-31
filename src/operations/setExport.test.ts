import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect } from "vitest";
import { fixtureTest as test } from "../__testHelpers__/helpers.js";
import { dispatchRequest } from "../daemon/dispatcher.js";

/**
 * Cases the scenario format can express only at a cost that hides what they test:
 * the referencing-file cap needs eleven importers, and the on-demand source-file
 * load needs a git repository that excludes the target.
 */

const TSCONFIG = `{
  "compilerOptions": { "strict": true },
  "include": ["src/**/*.ts"]
}
`;

const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };

function seedImporters(dir: string, count: number): void {
  fs.writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/a.ts"), "export function foo() { return 1; }\n");
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(
      path.join(dir, `src/importer${i}.ts`),
      `import { foo } from "./a";\n\nexport const value${i} = foo();\n`,
    );
  }
}

async function unexportFoo(dir: string, file = "src/a.ts") {
  return dispatchRequest(
    {
      method: "setExport",
      params: { file: path.join(dir, file), symbolName: "foo", exported: false },
    },
    dir,
  );
}

/** The file names a SYMBOL_IN_USE message actually lists, ignoring the overflow marker. */
function listedFiles(message: string): string[] {
  return (message.split("break them: ")[1] ?? "")
    .split(", ")
    .filter((entry) => entry !== "...")
    .map((entry) => path.basename(entry));
}

describe("setExport referencing-file reporting", () => {
  test("names every referencing file when the count sits on the cap", async ({ dir }) => {
    seedImporters(dir, 10);

    const result = await unexportFoo(dir);

    if (result.status !== "error") throw new Error(`expected an error, got ${result.status}`);
    expect(result.error).toBe("SYMBOL_IN_USE");
    expect(result.message).toContain("is used by 10 other file(s)");
    expect(listedFiles(result.message)).toHaveLength(10);
    expect(result.message).not.toContain("...");
  });

  test("lists the cap's worth past it and still reports the true count", async ({ dir }) => {
    seedImporters(dir, 11);

    const result = await unexportFoo(dir);

    if (result.status !== "error") throw new Error(`expected an error, got ${result.status}`);
    expect(result.message).toContain("is used by 11 other file(s)");
    // Sorted by path, so importer10 precedes importer2 and importer9 falls outside the cap.
    expect(listedFiles(result.message)).toEqual([
      "importer0.ts",
      "importer1.ts",
      "importer10.ts",
      "importer2.ts",
      "importer3.ts",
      "importer4.ts",
      "importer5.ts",
      "importer6.ts",
      "importer7.ts",
      "importer8.ts",
    ]);
    expect(result.message.endsWith(", ...")).toBe(true);
  });
});

describe("setExport on a file outside the project graph", () => {
  test("loads a target the workspace walk excludes", async ({ dir }) => {
    // Inside a repository the walk delegates to `git ls-files`, so an ignored file is
    // never added to the project up front and has to be loaded on demand.
    execSync("git init", { cwd: dir, env: GIT_ENV, stdio: "pipe" });
    fs.writeFileSync(path.join(dir, ".gitignore"), "generated/\n");
    fs.writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
    fs.mkdirSync(path.join(dir, "generated"), { recursive: true });
    fs.writeFileSync(path.join(dir, "generated/a.ts"), "function foo() { return 1; }\n");

    const result = await dispatchRequest(
      {
        method: "setExport",
        params: {
          file: path.join(dir, "generated/a.ts"),
          symbolName: "foo",
          exported: true,
        },
      },
      dir,
    );

    expect(result.status).toBe("success");
    expect(fs.readFileSync(path.join(dir, "generated/a.ts"), "utf8")).toBe(
      "export function foo() { return 1; }\n",
    );
  });
});
