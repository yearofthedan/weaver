import * as fs from "node:fs";
import * as path from "node:path";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures");

function fixtureContent(operation: string): string {
  const fixturePath = path.join(FIXTURES_DIR, `${operation}.json`);
  try {
    return fs.readFileSync(fixturePath, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error(
        `Case table references fixture "${operation}" but ${fixturePath} does not exist`,
      );
    }
    throw err;
  }
}

/** camelCase operation name → kebab-case CLI subcommand, matching src/adapters/cli/operations.ts */
export function operationToSubcommand(operation: string): string {
  return operation.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Reads the named fixture file and returns its content as a string. Used by the
 * LLM test runner to embed fixture JSON as a tool_result, by the harness to
 * build the per-subcommand default results, and by case-scoped `cannedResults`
 * overrides to reference a focused fixture variant (e.g. `"searchText-userId"`)
 * rather than inlining JSON.
 */
export function loadFixture(operation: string): string {
  return fixtureContent(operation);
}
