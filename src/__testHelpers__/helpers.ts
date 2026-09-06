import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createSelfWriteState } from "../daemon/self-write-state.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import type { TsMorphEngine } from "../ts-engine/engine.js";

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

/**
 * A scope wired the way the daemon wires one: writes go through the recording
 * decorator, which is what evicts a retained diagnostic parse. An engine driven
 * over a bare `NodeFileSystem` never sees that eviction, so a case about cache
 * freshness cannot be satisfied by one.
 */
export function makeDaemonScope(dir: string, engine: TsMorphEngine): WorkspaceScope {
  const state = createSelfWriteState(new NodeFileSystem(), (p) => engine.evictDiagnosticParse(p));
  return new WorkspaceScope(dir, state.fileSystem);
}
