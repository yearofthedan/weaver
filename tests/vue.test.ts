import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, fileExists, readFile, runCli } from "./helpers";

// useCounter is at line 1, col 17 in src/composables/useCounter.ts:
//   export function useCounter(initialValue = 0) {
//   123456789012345678
//                   ^ col 17

// greetUser is at line 1, col 17 in src/utils.ts:
//   export function greetUser(name: string): string {
//   123456789012345678
//                   ^ col 17

describe("router cross-boundary: .ts file in Vue project", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("renames a symbol defined in .ts when the project contains .vue files", () => {
    const dir = copyFixture("vue-ts-boundary");
    dirs.push(dir);

    const out = runCli(dir, [
      "rename",
      "--file",
      "src/utils.ts",
      "--line",
      "1",
      "--col",
      "17",
      "--newName",
      "welcomeUser",
    ]);

    expect(out.ok).toBe(true);
    if (!out.ok) return;

    // The .ts file itself must be updated
    expect(readFile(dir, "src/utils.ts")).toContain("welcomeUser");

    // The .vue consumer must also be updated — this is the cross-boundary case
    expect(readFile(dir, "src/App.vue")).toContain("welcomeUser");
    expect(readFile(dir, "src/App.vue")).not.toContain("greetUser");
  });
});

describe("vue engine", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup() {
    const dir = copyFixture("vue-project");
    dirs.push(dir);
    return dir;
  }

  describe("rename", () => {
    it("renames a composable used inside a .vue <script setup>", () => {
      const dir = setup();
      const out = runCli(dir, [
        "rename",
        "--file",
        "src/composables/useCounter.ts",
        "--line",
        "1",
        "--col",
        "17",
        "--newName",
        "useCount",
      ]);

      expect(out.ok).toBe(true);
      if (!out.ok) return;

      expect(readFile(dir, "src/composables/useCounter.ts")).toContain("useCount");
      expect(readFile(dir, "src/App.vue")).toContain("useCount");
    });
  });

  describe("move", () => {
    it("moves a TS file and rewrites the import inside the .vue SFC", () => {
      const dir = setup();
      const out = runCli(dir, [
        "move",
        "--oldPath",
        "src/composables/useCounter.ts",
        "--newPath",
        "src/utils/useCounter.ts",
      ]);

      expect(out.ok).toBe(true);
      if (!out.ok) return;

      // File is physically moved
      expect(fileExists(dir, "src/composables/useCounter.ts")).toBe(false);
      expect(fileExists(dir, "src/utils/useCounter.ts")).toBe(true);

      // App.vue import is rewritten by the post-move Vue scan
      const app = readFile(dir, "src/App.vue");
      expect(app).toContain("utils/useCounter");
      expect(app).not.toContain("composables/useCounter");

      // App.vue is reported as modified
      expect(out.filesModified.some((f) => f.endsWith("App.vue"))).toBe(true);
    });
  });
});
