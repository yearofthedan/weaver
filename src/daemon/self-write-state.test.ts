import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { createSelfWriteState, getSharedFileSystem } from "./self-write-state.js";

describe("createSelfWriteState", () => {
  it("suppresses exactly the next event for a path written through its filesystem", () => {
    const state = createSelfWriteState(new InMemoryFileSystem());

    state.fileSystem.writeFile("/w/written-by-daemon.ts", "export const x = 1;\n");

    expect(state.shouldSuppress("/w/written-by-daemon.ts")).toBe(true);
    // The entry is consumed on match — a second check on the same untouched
    // file must not suppress again, or a later genuine external edit to it
    // would be silently dropped.
    expect(state.shouldSuppress("/w/written-by-daemon.ts")).toBe(false);
  });

  it("never suppresses a path it has not seen written", () => {
    const state = createSelfWriteState(new InMemoryFileSystem());

    expect(state.shouldSuppress("/w/never-touched.ts")).toBe(false);
  });

  it("does not record a write made around it, straight to the underlying filesystem", () => {
    const inner = new InMemoryFileSystem();
    const state = createSelfWriteState(inner);

    inner.writeFile("/w/written-around-the-back.ts", "export const y = 1;\n");

    expect(state.shouldSuppress("/w/written-around-the-back.ts")).toBe(false);
  });

  it("keeps each state's ledger to itself", () => {
    const inner = new InMemoryFileSystem();
    const one = createSelfWriteState(inner);
    const two = createSelfWriteState(inner);

    one.fileSystem.writeFile("/w/only-known-to-one.ts", "export const z = 1;\n");

    expect(two.shouldSuppress("/w/only-known-to-one.ts")).toBe(false);
  });
});

describe("the daemon's shared filesystem", () => {
  it("is one instance, so every dispatched operation records into the same ledger", () => {
    expect(getSharedFileSystem()).toBe(getSharedFileSystem());
  });
});
