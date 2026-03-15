import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findTsConfig, findTsConfigForFile, isVueProject } from "../../src/utils/ts-project.js";

// The module-level caches in ts-project.ts persist for the process lifetime.
// Each test uses a unique mkdtempSync directory to guarantee no cache collision
// across tests.

describe("findTsConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-project-ftc-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(relPath: string, content = ""): string {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    return full;
  }

  it("returns the tsconfig.json path when present in the start directory", () => {
    const tsconfig = write("tsconfig.json", "{}");
    const result = findTsConfig(tmpDir);
    expect(result).toBe(tsconfig);
  });

  it("walks up directories to find tsconfig.json in a parent", () => {
    // tsconfig is at tmpDir root; start dir is two levels deeper
    const tsconfig = write("tsconfig.json", "{}");
    const deepDir = path.join(tmpDir, "src", "components");
    fs.mkdirSync(deepDir, { recursive: true });

    const result = findTsConfig(deepDir);

    // The walk-up loop must cross at least two levels to find this
    expect(result).toBe(tsconfig);
  });

  it("returns null when no tsconfig.json exists in any ancestor", () => {
    // tmpDir is under os.tmpdir() which has no tsconfig; walk reaches filesystem root
    const subDir = path.join(tmpDir, "deep", "nested");
    fs.mkdirSync(subDir, { recursive: true });

    expect(findTsConfig(subDir)).toBeNull();
  });

  it("returns the absolute path to tsconfig.json", () => {
    write("tsconfig.json", "{}");
    const result = findTsConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(path.isAbsolute(result!)).toBe(true);
  });

  it("caches a found tsconfig — second call returns same path even after file is deleted", () => {
    const tsconfig = write("tsconfig.json", "{}");

    const first = findTsConfig(tmpDir);
    expect(first).toBe(tsconfig);

    // Delete the file; cached call should still return the path
    fs.rmSync(tsconfig);
    const second = findTsConfig(tmpDir);
    expect(second).toBe(tsconfig);
  });

  it("caches a null result — second call returns null even after tsconfig is created", () => {
    const subDir = path.join(tmpDir, "no-config");
    fs.mkdirSync(subDir);

    const first = findTsConfig(subDir);
    expect(first).toBeNull();

    // Create a tsconfig; cache must still return null
    fs.writeFileSync(path.join(subDir, "tsconfig.json"), "{}");
    const second = findTsConfig(subDir);
    expect(second).toBeNull();
  });
});

describe("findTsConfigForFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-project-ftcf-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds tsconfig.json starting from the directory containing the file", () => {
    const tsconfig = path.join(tmpDir, "tsconfig.json");
    fs.writeFileSync(tsconfig, "{}", "utf8");

    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);
    const file = path.join(srcDir, "utils.ts");
    fs.writeFileSync(file, "", "utf8");

    // starts from dirname(file) = srcDir, walks up to tmpDir
    const result = findTsConfigForFile(file);
    expect(result).toBe(tsconfig);
  });

  it("returns null when no tsconfig.json exists above the file", () => {
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);
    const file = path.join(srcDir, "utils.ts");
    fs.writeFileSync(file, "", "utf8");

    expect(findTsConfigForFile(file)).toBeNull();
  });
});

describe("isVueProject", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-project-ivp-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(relPath: string, content = ""): string {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    return full;
  }

  it("returns true when .vue files are present in the project root", () => {
    const tsconfig = write("tsconfig.json", "{}");
    write("src/App.vue", "<template><div/></template>");

    expect(isVueProject(tsconfig)).toBe(true);
  });

  it("returns false when no .vue files exist in the project", () => {
    const tsconfig = write("tsconfig.json", "{}");
    write("src/main.ts", "");
    write("src/utils.ts", "");

    expect(isVueProject(tsconfig)).toBe(false);
  });

  it("returns false for a TS-only project (not a Vue project)", () => {
    const tsconfig = write("tsconfig.json", "{}");
    write("src/index.ts", "export const x = 1;");

    expect(isVueProject(tsconfig)).toBe(false);
  });

  it("caches a true result — second call returns true even after .vue file is deleted", () => {
    const tsconfig = write("tsconfig.json", "{}");
    const vueFile = write("src/App.vue", "<template/>");

    const first = isVueProject(tsconfig);
    expect(first).toBe(true);

    // Delete the .vue file; cache must still return true
    fs.rmSync(vueFile);
    const second = isVueProject(tsconfig);
    expect(second).toBe(true);
  });

  it("caches a false result — second call returns false even after .vue file is created", () => {
    const tsconfig = write("tsconfig.json", "{}");
    write("src/index.ts", "");

    const first = isVueProject(tsconfig);
    expect(first).toBe(false);

    // Create a .vue file; cache must still return false
    write("src/App.vue", "<template/>");
    const second = isVueProject(tsconfig);
    expect(second).toBe(false);
  });

  it("returns false when .vue files exist only outside tsconfig include patterns", () => {
    const tsconfig = write(
      "tsconfig.json",
      JSON.stringify({
        include: ["src/**/*.ts", "src/**/*.vue"],
      }),
    );
    write("src/main.ts", "");
    write("tests/fixtures/App.vue", "<template><div/></template>");

    expect(isVueProject(tsconfig)).toBe(false);
  });

  it("returns false when .vue files are excluded by tsconfig exclude", () => {
    const tsconfig = write(
      "tsconfig.json",
      JSON.stringify({
        include: ["**/*.ts", "**/*.vue"],
        exclude: ["vendor/**"],
      }),
    );
    write("src/main.ts", "");
    write("vendor/legacy/App.vue", "<template/>");

    expect(isVueProject(tsconfig)).toBe(false);
  });
});
