import { beforeEach, describe, expect, it, vi } from "vitest";
import { isSameBuild, readBuildId } from "./build-id.js";

const mockStatSync = vi.fn();

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, statSync: (...args: unknown[]) => mockStatSync(...args) };
});

describe("isSameBuild", () => {
  it.each([
    { daemon: 1700000000000, local: 1700000000000, same: true, desc: "same build on both sides" },
    {
      daemon: 1700000000000,
      local: 1700000000001,
      same: false,
      desc: "daemon on a different build",
    },
    // 0 is a valid mtime, so it must not be read as "missing" via truthiness.
    { daemon: 0, local: 0, same: true, desc: "an epoch mtime, which is a real value" },
    { daemon: null, local: null, same: true, desc: "neither side running a build" },
    { daemon: 1700000000000, local: null, same: false, desc: "only the daemon on a build" },
    { daemon: null, local: 1700000000000, same: false, desc: "only this side on a build" },
    { daemon: undefined, local: 1700000000000, same: false, desc: "a daemon omitting the field" },
    { daemon: "1700000000000", local: 1700000000000, same: false, desc: "a non-numeric build id" },
  ])("$desc", ({ daemon, local, same }) => {
    expect(isSameBuild(daemon, local)).toBe(same);
  });
});

describe("readBuildId", () => {
  beforeEach(() => {
    mockStatSync.mockReset();
  });

  it("returns the entry file's modification time", () => {
    mockStatSync.mockReturnValue({ mtimeMs: 1700000000000 });

    expect(readBuildId()).toBe(1700000000000);
  });

  it("returns null when the entry cannot be read", () => {
    mockStatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(readBuildId()).toBeNull();
  });
});
