import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { conformanceSuite } from "./__testHelpers__/filesystem-conformance.js";
import { NodeFileSystem } from "./node-filesystem.js";

conformanceSuite("NodeFileSystem", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "node-vfs-"));
  return {
    vfs: new NodeFileSystem(),
    root: tmpDir,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
});
