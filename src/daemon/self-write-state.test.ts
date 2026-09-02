import * as path from "node:path";
import { describe, expect } from "vitest";
import { fixtureTest as test } from "../__testHelpers__/helpers.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { getSharedFileSystem, shouldSuppressSelfWrite } from "./self-write-state.js";

describe("shared daemon filesystem", () => {
  test("returns the same instance on every call, so every caller records into one ledger", () => {
    expect(getSharedFileSystem()).toBe(getSharedFileSystem());
  });

  test("a write through the shared filesystem suppresses exactly the next event for that path", async ({
    dir,
  }) => {
    const file = path.join(dir, "written-by-daemon.ts");

    getSharedFileSystem().writeFile(file, "export const x = 1;\n");

    expect(shouldSuppressSelfWrite(file)).toBe(true);
    // The entry is consumed on match — a second check on the same untouched
    // file must not suppress again, or a later genuine external edit to it
    // would be silently dropped.
    expect(shouldSuppressSelfWrite(file)).toBe(false);
  });

  test("a path never written through the shared filesystem is never suppressed", ({ dir }) => {
    expect(shouldSuppressSelfWrite(path.join(dir, "never-touched.ts"))).toBe(false);
  });

  test("a write made through a filesystem other than the shared instance is not recorded", ({
    dir,
  }) => {
    const file = path.join(dir, "written-around-the-back.ts");

    new NodeFileSystem().writeFile(file, "export const y = 1;\n");

    expect(shouldSuppressSelfWrite(file)).toBe(false);
  });
});
