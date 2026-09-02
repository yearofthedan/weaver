import { describe, expect, it, vi } from "vitest";
import { buildWatcherCallbacks } from "./daemon.js";

describe("buildWatcherCallbacks", () => {
  function harness(shouldSuppress: (filePath: string) => boolean) {
    const invalidateFile = vi.fn();
    const invalidateAll = vi.fn();
    const callbacks = buildWatcherCallbacks({ shouldSuppress, invalidateFile, invalidateAll });
    return { callbacks, invalidateFile, invalidateAll };
  }

  describe.each([
    ["a .ts file", "/workspace/src/utils.ts"],
    ["a .vue file", "/workspace/src/App.vue"],
  ])("for %s", (_label, filePath) => {
    describe("onFileChanged", () => {
      it("skips invalidateFile when the ledger marks the write as the daemon's own", () => {
        const { callbacks, invalidateFile } = harness(() => true);

        callbacks.onFileChanged(filePath);

        expect(invalidateFile).not.toHaveBeenCalled();
      });

      it("invalidates the file when the ledger does not recognise the write", () => {
        const { callbacks, invalidateFile } = harness(() => false);

        callbacks.onFileChanged(filePath);

        expect(invalidateFile).toHaveBeenCalledExactlyOnceWith(filePath);
      });
    });

    describe("onFileAdded", () => {
      it("skips invalidateAll when the ledger marks the add as the daemon's own", () => {
        const { callbacks, invalidateAll } = harness(() => true);

        callbacks.onFileAdded(filePath);

        expect(invalidateAll).not.toHaveBeenCalled();
      });

      it("invalidates all compilers when the ledger does not recognise the add", () => {
        const { callbacks, invalidateAll } = harness(() => false);

        callbacks.onFileAdded(filePath);

        expect(invalidateAll).toHaveBeenCalledOnce();
      });
    });

    describe("onFileRemoved", () => {
      it("skips invalidateAll when the ledger marks the removal as the daemon's own", () => {
        const { callbacks, invalidateAll } = harness(() => true);

        callbacks.onFileRemoved(filePath);

        expect(invalidateAll).not.toHaveBeenCalled();
      });

      it("invalidates all compilers when the ledger does not recognise the removal", () => {
        const { callbacks, invalidateAll } = harness(() => false);

        callbacks.onFileRemoved(filePath);

        expect(invalidateAll).toHaveBeenCalledOnce();
      });
    });
  });

  it("asks the ledger about the exact path from the event, not a derived one", () => {
    const shouldSuppress = vi.fn(() => true);
    const { callbacks } = harness(shouldSuppress);

    callbacks.onFileChanged("/workspace/src/exact-path.ts");

    expect(shouldSuppress).toHaveBeenCalledExactlyOnceWith("/workspace/src/exact-path.ts");
  });
});
