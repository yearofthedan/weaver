import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export { FIXTURES, type FixtureName, fixtureTest } from "./fixtures/fixtures.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "../..");

/** Read a file relative to a fixture temp dir. */
export function readFile(dir: string, relative: string): string {
  return fs.readFileSync(path.join(dir, relative), "utf8");
}

/** Check whether a file exists relative to a fixture temp dir. */
export function fileExists(dir: string, relative: string): boolean {
  return fs.existsSync(path.join(dir, relative));
}
