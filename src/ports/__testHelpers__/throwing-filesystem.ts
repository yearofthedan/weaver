import { WorkspaceScope } from "../../domain/workspace-scope.js";
import type { FileSystem } from "../filesystem.js";
import { NodeFileSystem } from "../node-filesystem.js";

export function makeThrowingScope(dir: string, failPath: string): WorkspaceScope {
  const base = new NodeFileSystem();
  const throwingFs: FileSystem = {
    readFile: (p) => {
      if (p === failPath) throw new Error("EACCES: permission denied");
      return base.readFile(p);
    },
    writeFile: (p, c) => base.writeFile(p, c),
    exists: (p) => base.exists(p),
    mkdir: (p, o) => base.mkdir(p, o),
    rename: (o, n) => base.rename(o, n),
    unlink: (p) => base.unlink(p),
    realpath: (p) => base.realpath(p),
    resolve: (...s) => base.resolve(...s),
    stat: (p) => base.stat(p),
  };
  return new WorkspaceScope(dir, throwingFs);
}
