import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";
import { conformanceSuite } from "./__helpers__/filesystem-conformance.js";

conformanceSuite("NodeFileSystem", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "node-vfs-"));
  return {
    vfs: new NodeFileSystem(),
    root: tmpDir,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
});
