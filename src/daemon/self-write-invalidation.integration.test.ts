import * as nodeFs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, vi } from "vitest";
import { fixtureTest as test } from "../__testHelpers__/helpers.js";
import { VUE_EXTENSIONS } from "../utils/extensions.js";
import { buildWatcherCallbacks } from "./daemon.js";
import { getSharedFileSystem, shouldSuppressSelfWrite } from "./self-write-state.js";
import type { WatcherHandle } from "./watcher.js";
import { startWatcher } from "./watcher.js";

const DEBOUNCE_MARGIN_MS = 500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Starts a real watcher over `dir` wired exactly as the daemon wires it —
 * through `buildWatcherCallbacks` and the shared self-write ledger — but
 * with spies standing in for the compiler-invalidation callbacks, so a test
 * can observe whether an event reached them without a real compiler.
 */
function watchWithSpies(dir: string) {
  const invalidateFile = vi.fn();
  const invalidateAll = vi.fn();
  const handle = startWatcher(
    dir,
    VUE_EXTENSIONS,
    buildWatcherCallbacks({
      shouldSuppress: shouldSuppressSelfWrite,
      invalidateFile,
      invalidateAll,
    }),
  );
  return { handle, invalidateFile, invalidateAll };
}

describe("daemon self-write invalidation", () => {
  const handles: WatcherHandle[] = [];

  afterEach(async () => {
    for (const h of handles.splice(0)) await h.stop();
  });

  describe.each([
    ["a .ts file", "src/util.ts"],
    ["a .vue file", "src/App.vue"],
  ])("for %s", (_label, relativePath) => {
    test("suppresses invalidateFile for a change the daemon itself wrote", async ({ dir }) => {
      const file = path.join(dir, relativePath);
      nodeFs.mkdirSync(path.dirname(file), { recursive: true });
      nodeFs.writeFileSync(file, "original content\n");

      const { handle, invalidateFile } = watchWithSpies(dir);
      handles.push(handle);
      await wait(150);

      getSharedFileSystem().writeFile(file, "written by the daemon\n");
      await wait(DEBOUNCE_MARGIN_MS);

      expect(invalidateFile).not.toHaveBeenCalled();
    });

    test("still invalidates a change made by something other than the daemon", async ({ dir }) => {
      const file = path.join(dir, relativePath);
      nodeFs.mkdirSync(path.dirname(file), { recursive: true });
      nodeFs.writeFileSync(file, "original content\n");

      const { handle, invalidateFile } = watchWithSpies(dir);
      handles.push(handle);
      await wait(150);

      nodeFs.writeFileSync(file, "written by an editor\n");
      await wait(DEBOUNCE_MARGIN_MS);

      expect(invalidateFile).toHaveBeenCalledExactlyOnceWith(file);
    });

    test("suppresses invalidateAll for a file the daemon itself created", async ({ dir }) => {
      const file = path.join(dir, relativePath);
      nodeFs.mkdirSync(path.dirname(file), { recursive: true });

      const { handle, invalidateAll } = watchWithSpies(dir);
      handles.push(handle);
      await wait(150);

      getSharedFileSystem().writeFile(file, "created by the daemon\n");
      await wait(DEBOUNCE_MARGIN_MS);

      expect(invalidateAll).not.toHaveBeenCalled();
    });

    test("still invalidates a file created by something other than the daemon", async ({ dir }) => {
      const file = path.join(dir, relativePath);
      nodeFs.mkdirSync(path.dirname(file), { recursive: true });

      const { handle, invalidateAll } = watchWithSpies(dir);
      handles.push(handle);
      await wait(150);

      nodeFs.writeFileSync(file, "created by an editor\n");
      await wait(DEBOUNCE_MARGIN_MS);

      expect(invalidateAll).toHaveBeenCalledOnce();
    });

    test("suppresses invalidateAll for a file the daemon itself deleted", async ({ dir }) => {
      const file = path.join(dir, relativePath);
      nodeFs.mkdirSync(path.dirname(file), { recursive: true });
      nodeFs.writeFileSync(file, "about to be removed by the daemon\n");

      const { handle, invalidateAll } = watchWithSpies(dir);
      handles.push(handle);
      await wait(150);

      getSharedFileSystem().unlink(file);
      await wait(DEBOUNCE_MARGIN_MS);

      expect(invalidateAll).not.toHaveBeenCalled();
    });

    test("still invalidates a file deleted by something other than the daemon", async ({ dir }) => {
      const file = path.join(dir, relativePath);
      nodeFs.mkdirSync(path.dirname(file), { recursive: true });
      nodeFs.writeFileSync(file, "about to be removed by an editor\n");

      const { handle, invalidateAll } = watchWithSpies(dir);
      handles.push(handle);
      await wait(150);

      nodeFs.unlinkSync(file);
      await wait(DEBOUNCE_MARGIN_MS);

      expect(invalidateAll).toHaveBeenCalledOnce();
    });
  });

  test("an external write landing on top of the daemon's own write is not suppressed", async ({
    dir,
  }) => {
    const file = path.join(dir, "src/racing.ts");
    nodeFs.mkdirSync(path.dirname(file), { recursive: true });
    nodeFs.writeFileSync(file, "original content\n");

    const { handle, invalidateFile } = watchWithSpies(dir);
    handles.push(handle);
    await wait(150);

    getSharedFileSystem().writeFile(file, "written by the daemon\n");
    // A real external edit landing before the watcher's debounced event fires
    // for the daemon's write — the file's mtime moves past the ledger's
    // recorded stamp, so the eventual event must not be swallowed.
    await wait(20);
    nodeFs.writeFileSync(file, "then overwritten by an editor\n");
    await wait(DEBOUNCE_MARGIN_MS);

    expect(invalidateFile).toHaveBeenCalledExactlyOnceWith(file);
  });
});
