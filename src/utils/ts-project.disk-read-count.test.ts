import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as ts from "typescript";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

vi.mock("typescript", async (importOriginal) => {
  const actual = await importOriginal<typeof import("typescript")>();
  const parseJsonConfigFileContent = vi.fn(actual.parseJsonConfigFileContent);
  return {
    ...actual,
    parseJsonConfigFileContent,
    default: {
      ...(actual as unknown as { default: typeof actual }).default,
      parseJsonConfigFileContent,
    },
  };
});

const existsSyncMock = vi.mocked(fs.existsSync);
const parseJsonConfigFileContentMock = vi.mocked(ts.parseJsonConfigFileContent);

let findTsConfig: typeof import("./ts-project.js").findTsConfig;
let isVueProject: typeof import("./ts-project.js").isVueProject;

beforeAll(async () => {
  // The suite's global setup file (test-cleanup.ts) imports language-plugin-registry.js,
  // which imports ts-project.js at module load time — before this file's vi.mock calls above
  // can register. That locks ts-project.js's "node:fs"/"typescript" bindings to the real
  // modules for the rest of the run. Resetting the module registry and re-importing here
  // is the only way to get an instance of ts-project.js bound to the mocked reads, so its
  // disk-read counts are observable.
  vi.resetModules();
  ({ findTsConfig, isVueProject } = await import("./ts-project.js"));
});

describe("discovery disk-read counts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-project-read-count-"));
    existsSyncMock.mockClear();
    parseJsonConfigFileContentMock.mockClear();
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

  it("checks the filesystem once per distinct directory queried by findTsConfig, regardless of how many times each is queried", () => {
    write("tsconfig.json", "{}");
    const dirA = path.join(tmpDir, "packages", "a");
    const dirB = path.join(tmpDir, "packages", "b");
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });

    findTsConfig(dirA);
    findTsConfig(dirA);
    const readsAfterDirA = existsSyncMock.mock.calls.length;
    expect(readsAfterDirA).toBeGreaterThan(0);

    findTsConfig(dirB);
    const readsAfterDirB = existsSyncMock.mock.calls.length;
    expect(readsAfterDirB).toBeGreaterThan(readsAfterDirA);

    findTsConfig(dirB);
    findTsConfig(dirA);

    expect(existsSyncMock.mock.calls.length).toBe(readsAfterDirB);
  });

  it("parses for .vue membership once per project root queried by isVueProject, regardless of how many times each is queried", () => {
    const tsconfigA = write("a/tsconfig.json", "{}");
    const tsconfigB = write("b/tsconfig.json", "{}");

    isVueProject(tsconfigA);
    isVueProject(tsconfigA);
    expect(parseJsonConfigFileContentMock).toHaveBeenCalledTimes(1);

    isVueProject(tsconfigB);
    expect(parseJsonConfigFileContentMock).toHaveBeenCalledTimes(2);

    isVueProject(tsconfigB);
    isVueProject(tsconfigA);

    expect(parseJsonConfigFileContentMock).toHaveBeenCalledTimes(2);
  });
});
