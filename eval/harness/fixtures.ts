import * as fs from "node:fs";
import * as path from "node:path";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures");

/** camelCase operation name → kebab-case CLI subcommand, matching src/adapters/cli/operations.ts */
export function operationToSubcommand(operation: string): string {
  return operation.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Reads a fixture file (path relative to `eval/fixtures/`, extension included)
 * and returns its content — the canned stdout a tool call is fed.
 */
export function loadFixture(name: string): string {
  const fixturePath = path.join(FIXTURES_DIR, name);
  try {
    return fs.readFileSync(fixturePath, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error(`Case table references fixture "${name}" but ${fixturePath} does not exist`);
    }
    throw err;
  }
}
