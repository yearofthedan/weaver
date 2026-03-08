import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import type { FileSystem } from "./filesystem.js";

/**
 * Production implementation that delegates to `node:fs` synchronous methods
 * and `node:path` for path resolution.
 *
 * Intended to be constructed once at daemon startup and shared across all
 * operations via `WorkspaceScope`.
 */
export class NodeFileSystem implements FileSystem {
  readFile(path: string): string {
    return nodeFs.readFileSync(path, "utf8");
  }

  writeFile(path: string, content: string): void {
    nodeFs.writeFileSync(path, content, "utf8");
  }

  exists(path: string): boolean {
    return nodeFs.existsSync(path);
  }

  mkdir(path: string, options?: { recursive?: boolean }): void {
    nodeFs.mkdirSync(path, options);
  }

  rename(oldPath: string, newPath: string): void {
    nodeFs.renameSync(oldPath, newPath);
  }

  unlink(path: string): void {
    nodeFs.unlinkSync(path);
  }

  realpath(path: string): string {
    return nodeFs.realpathSync(path);
  }

  resolve(...segments: string[]): string {
    return nodePath.resolve(...segments);
  }

  stat(path: string): { isDirectory(): boolean } {
    return nodeFs.statSync(path);
  }
}
