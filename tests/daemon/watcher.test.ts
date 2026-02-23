import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WatcherHandle } from "../../src/daemon/watcher.js";
import { startWatcher } from "../../src/daemon/watcher.js";
import { TS_EXTENSIONS } from "../../src/engines/file-walk.js";

describe("startWatcher", () => {
  let tmpDir: string;
  const handles: WatcherHandle[] = [];

  function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "watcher-test-"));
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "export const x = 1;\n");
  });

  afterEach(async () => {
    for (const h of handles.splice(0)) {
      await h.stop();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("calls onFileChanged when a .ts file is modified", async () => {
    const changed: string[] = [];
    const handle = startWatcher(tmpDir, TS_EXTENSIONS, {
      onFileChanged: (p) => changed.push(p),
      onFileAdded: () => {},
      onFileRemoved: () => {},
    });
    handles.push(handle);

    await wait(150);

    const file = path.join(tmpDir, "src", "index.ts");
    fs.writeFileSync(file, "export const x = 2;\n");

    await wait(400);
    expect(changed).toContain(file);
  });

  it("calls onFileAdded when a new .ts file is created", async () => {
    const added: string[] = [];
    const handle = startWatcher(tmpDir, TS_EXTENSIONS, {
      onFileChanged: () => {},
      onFileAdded: (p) => added.push(p),
      onFileRemoved: () => {},
    });
    handles.push(handle);

    await wait(150);

    const newFile = path.join(tmpDir, "src", "new.ts");
    fs.writeFileSync(newFile, "export const y = 1;\n");

    await wait(400);
    expect(added).toContain(newFile);
  });

  it("calls onFileRemoved when a .ts file is deleted", async () => {
    const removed: string[] = [];
    const handle = startWatcher(tmpDir, TS_EXTENSIONS, {
      onFileChanged: () => {},
      onFileAdded: () => {},
      onFileRemoved: (p) => removed.push(p),
    });
    handles.push(handle);

    await wait(150);

    const file = path.join(tmpDir, "src", "index.ts");
    fs.unlinkSync(file);

    await wait(400);
    expect(removed).toContain(file);
  });

  it("does not call callbacks for non-source files", async () => {
    const calls: string[] = [];
    const handle = startWatcher(tmpDir, TS_EXTENSIONS, {
      onFileChanged: (p) => calls.push(p),
      onFileAdded: (p) => calls.push(p),
      onFileRemoved: (p) => calls.push(p),
    });
    handles.push(handle);

    await wait(150);

    fs.writeFileSync(path.join(tmpDir, "README.md"), "hello\n");
    fs.writeFileSync(path.join(tmpDir, "config.json"), "{}");

    await wait(400);
    expect(calls).toHaveLength(0);
  });

  it("does not call callbacks for files inside node_modules", async () => {
    const calls: string[] = [];
    const nmDir = path.join(tmpDir, "node_modules", "some-pkg");
    fs.mkdirSync(nmDir, { recursive: true });

    const handle = startWatcher(tmpDir, TS_EXTENSIONS, {
      onFileChanged: (p) => calls.push(p),
      onFileAdded: (p) => calls.push(p),
      onFileRemoved: (p) => calls.push(p),
    });
    handles.push(handle);

    await wait(150);

    fs.writeFileSync(path.join(nmDir, "index.ts"), "// module\n");

    await wait(400);
    expect(calls).toHaveLength(0);
  });

  it("stop() closes the watcher and no further events fire", async () => {
    const changed: string[] = [];
    const handle = startWatcher(tmpDir, TS_EXTENSIONS, {
      onFileChanged: (p) => changed.push(p),
      onFileAdded: () => {},
      onFileRemoved: () => {},
    });
    // not pushed to handles — stopped manually below

    await wait(150);
    await handle.stop();

    const file = path.join(tmpDir, "src", "index.ts");
    fs.writeFileSync(file, "export const x = 3;\n");

    await wait(400);
    expect(changed).toHaveLength(0);
  });
});
