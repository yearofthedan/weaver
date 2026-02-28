import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "..");

/**
 * Copy a named fixture to a fresh temp directory and return its path.
 * Each test should call this to get an isolated, mutable copy.
 */
export function copyFixture(name: string): string {
  const src = path.join(PROJECT_ROOT, "tests", "fixtures", name);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), `ns-${name}-`));
  copyDirSync(src, dest);
  return dest;
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDirSync(s, d) : fs.copyFileSync(s, d);
  }
}

/** Read a file relative to a fixture temp dir. */
export function readFile(dir: string, relative: string): string {
  return fs.readFileSync(path.join(dir, relative), "utf8");
}

/** Check whether a file exists relative to a fixture temp dir. */
export function fileExists(dir: string, relative: string): boolean {
  return fs.existsSync(path.join(dir, relative));
}

/** Delete a temp dir produced by copyFixture. */
export function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
