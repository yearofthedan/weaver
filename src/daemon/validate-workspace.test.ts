import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FileSystem } from "../ports/filesystem.js";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { validateWorkspace } from "./validate-workspace.js";

describe("validateWorkspace", () => {
  describe("with InMemoryFileSystem", () => {
    function makeFs(dirs: string[] = [], files: string[] = []): FileSystem {
      const vfs = new InMemoryFileSystem();
      for (const d of dirs) vfs.mkdir(d, { recursive: true });
      for (const f of files) vfs.writeFile(f, "");
      return vfs;
    }

    it("accepts a valid workspace directory", () => {
      const vfs = makeFs(["/workspace"]);
      const result = validateWorkspace("/workspace", vfs);
      expect(result).toEqual({ ok: true, workspace: "/workspace" });
    });

    it("rejects a non-existent path", () => {
      const vfs = makeFs();
      const result = validateWorkspace("/does-not-exist", vfs);
      expect(result).toEqual({
        ok: false,
        error: "Workspace directory not found: /does-not-exist",
      });
    });

    it("rejects a file (non-directory)", () => {
      const vfs = makeFs([], ["/workspace/file.txt"]);
      const result = validateWorkspace("/workspace/file.txt", vfs);
      expect(result).toMatchObject({
        ok: false,
        error: expect.stringContaining("not a directory"),
      });
    });

    it.each([
      "/",
      "/bin",
      "/boot",
      "/dev",
      "/etc",
      "/lib",
      "/lib64",
      "/proc",
      "/root",
      "/sbin",
      "/sys",
      "/usr",
      "/var",
    ])("rejects restricted system path: %s", (restrictedPath) => {
      const vfs = makeFs([restrictedPath]);
      const result = validateWorkspace(restrictedPath, vfs);
      // A path that *is* a restricted root reports "is", distinct from the
      // "resolves to" message used for a symlink that escapes into one.
      expect(result).toEqual({
        ok: false,
        error: `Workspace is a restricted system path: ${restrictedPath}`,
      });
    });

    it("rejects a user credential directory", () => {
      const awsDir = path.join(os.homedir(), ".aws");
      const vfs = makeFs([awsDir]);
      const result = validateWorkspace(awsDir, vfs);
      expect(result).toEqual({
        ok: false,
        error: `Workspace is a restricted system path: ${awsDir}`,
      });
    });

    it("rejects a path whose injected realpath resolves to a restricted root", () => {
      const innocuousDir = "/projects/link";
      const vfs = new InMemoryFileSystem() as FileSystem & { _realpath?: Map<string, string> };
      vfs.mkdir(innocuousDir, { recursive: true });

      const withSymlink = new Proxy(vfs, {
        get(target, prop) {
          if (prop === "realpath") {
            return (p: string) => (p === innocuousDir ? "/etc" : p);
          }
          return (target as unknown as Record<string | symbol, unknown>)[prop];
        },
      }) as FileSystem;

      const result = validateWorkspace(innocuousDir, withSymlink);
      // The path itself is not restricted; it's rejected because it *resolves*
      // into one — a distinct message from the direct case above.
      expect(result).toEqual({
        ok: false,
        error: `Workspace resolves to a restricted system path: ${innocuousDir}`,
      });
    });

    it("rejects a path whose injected realpath resolves to /private/etc (macOS /etc canonical form)", () => {
      const innocuousDir = "/projects/link";
      const vfs = new InMemoryFileSystem();
      vfs.mkdir(innocuousDir, { recursive: true });

      const withSymlink = new Proxy(vfs, {
        get(target, prop) {
          if (prop === "realpath") {
            return (p: string) => {
              if (p === innocuousDir) return "/private/etc";
              if (p === "/etc") return "/private/etc";
              return p;
            };
          }
          return (target as unknown as Record<string | symbol, unknown>)[prop];
        },
      }) as FileSystem;

      const result = validateWorkspace(innocuousDir, withSymlink);
      expect(result).toEqual({
        ok: false,
        error: `Workspace resolves to a restricted system path: ${innocuousDir}`,
      });
    });

    it("returns the path.resolve'd workspace path (not realpath) on success", () => {
      const vfs = makeFs(["/workspace"]);
      const result = validateWorkspace("/workspace", vfs);
      expect(result).toEqual({ ok: true, workspace: "/workspace" });
    });

    it("rejects when realpath throws (unresolvable path)", () => {
      const dir = "/broken";
      const vfs = new InMemoryFileSystem();
      vfs.mkdir(dir, { recursive: true });

      const withBrokenRealpath = new Proxy(vfs, {
        get(target, prop) {
          if (prop === "realpath") {
            return () => {
              throw new Error("ENOENT");
            };
          }
          return (target as unknown as Record<string | symbol, unknown>)[prop];
        },
      }) as FileSystem;

      const result = validateWorkspace(dir, withBrokenRealpath);
      expect(result).toMatchObject({
        ok: false,
        error: expect.stringContaining("Could not resolve"),
      });
    });
  });

  describe("with real disk (regression)", () => {
    const tmpDirs: string[] = [];

    afterEach(() => {
      for (const d of tmpDirs.splice(0)) {
        fs.rmSync(d, { recursive: true, force: true });
      }
    });

    function makeTmpDir(): string {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), "ws-val-"));
      tmpDirs.push(d);
      return d;
    }

    it("accepts a valid workspace directory", () => {
      const dir = makeTmpDir();
      const result = validateWorkspace(dir, new NodeFileSystem());
      expect(result).toMatchObject({ ok: true, workspace: dir });
    });

    it("rejects a symlink that resolves to a restricted path via NodeFileSystem", () => {
      const dir = makeTmpDir();
      const link = path.join(dir, "etc-link");
      fs.symlinkSync("/etc", link);
      const result = validateWorkspace(link, new NodeFileSystem());
      expect(result).toMatchObject({
        ok: false,
        error: expect.stringContaining("resolves to a restricted system path"),
      });
    });
  });
});
