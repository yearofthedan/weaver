import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isWithinWorkspace, validateWorkspace } from "../../src/security.js";

describe("isWithinWorkspace", () => {
  const ws = "/tmp/my-workspace";

  // Temp dirs created for real-filesystem tests.
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function makeTmpDir(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "ws-iswithin-"));
    tmpDirs.push(d);
    return d;
  }

  it("returns true for a path inside the workspace", () => {
    expect(isWithinWorkspace("/tmp/my-workspace/src/foo.ts", ws)).toBe(true);
  });

  it("returns true for a path equal to the workspace root", () => {
    expect(isWithinWorkspace("/tmp/my-workspace", ws)).toBe(true);
  });

  it("returns false for a sibling directory that shares the workspace prefix", () => {
    // /tmp/my-workspace-other starts with /tmp/my-workspace but is NOT inside it
    expect(isWithinWorkspace("/tmp/my-workspace-other/file.ts", ws)).toBe(false);
  });

  it("returns false for a path in a completely different directory", () => {
    expect(isWithinWorkspace("/tmp/other/file.ts", ws)).toBe(false);
  });

  it("returns false for a path that resolves outside via ..", () => {
    // path.resolve normalises this to /tmp/other/file.ts
    expect(isWithinWorkspace("/tmp/my-workspace/../other/file.ts", ws)).toBe(false);
  });

  it("returns true for a deeply nested path", () => {
    expect(isWithinWorkspace("/tmp/my-workspace/a/b/c/d/index.ts", ws)).toBe(true);
  });

  it("returns false for the parent of the workspace", () => {
    expect(isWithinWorkspace("/tmp", ws)).toBe(false);
  });

  it("returns false for a root path", () => {
    expect(isWithinWorkspace("/", ws)).toBe(false);
  });

  it("handles absolute paths computed with path.join correctly", () => {
    const inside = path.join(ws, "src/index.ts");
    expect(isWithinWorkspace(inside, ws)).toBe(true);
  });

  it("returns false for a symlink inside the workspace that resolves outside", () => {
    // Create two real directories: workspace and an outside target.
    const workspace = makeTmpDir();
    const outside = makeTmpDir();

    // Place a file in the outside directory.
    const outsideFile = path.join(outside, "secret.ts");
    fs.writeFileSync(outsideFile, "");

    // Create a symlink inside the workspace pointing to the outside file.
    const link = path.join(workspace, "escape.ts");
    fs.symlinkSync(outsideFile, link);

    // isWithinWorkspace must reject it even though the link itself is inside.
    expect(isWithinWorkspace(link, workspace)).toBe(false);
  });

  it("returns true for a regular (non-symlink) file that actually exists inside the workspace", () => {
    const workspace = makeTmpDir();
    const file = path.join(workspace, "src", "index.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "");
    expect(isWithinWorkspace(file, workspace)).toBe(true);
  });
});

describe("validateWorkspace", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function makeTmpDir(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "ws-test-"));
    tmpDirs.push(d);
    return d;
  }

  it("accepts a valid workspace directory", () => {
    const dir = makeTmpDir();
    const result = validateWorkspace(dir);
    expect(result).toMatchObject({ ok: true, workspace: dir });
  });

  it("rejects a non-existent path", () => {
    const result = validateWorkspace("/tmp/does-not-exist-xyzzy-999");
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects a file (non-directory)", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, "file.txt");
    fs.writeFileSync(file, "");
    const result = validateWorkspace(file);
    expect(result).toMatchObject({ ok: false });
  });

  // System paths that are guaranteed to exist on Linux — each must be rejected.
  it.each([
    "/",
    "/etc",
    "/usr",
    "/var",
    "/bin",
  ])("rejects restricted system path: %s", (restrictedPath) => {
    const result = validateWorkspace(restrictedPath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/restricted/i);
  });

  // User credential directories — only tested when the path actually exists on
  // the current machine, since not every developer has all of these.
  const credentialDirs = [".aws", ".azure", ".gnupg", ".kube", ".ssh"]
    .map((d) => path.join(os.homedir(), d))
    .filter((p) => fs.existsSync(p));

  it.each(credentialDirs)("rejects user credential directory: %s", (credPath) => {
    const result = validateWorkspace(credPath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/restricted/i);
  });

  it("rejects a symlink that resolves to a restricted path", () => {
    const dir = makeTmpDir();
    const link = path.join(dir, "etc-link");
    fs.symlinkSync("/etc", link);
    const result = validateWorkspace(link);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/restricted/i);
  });
});
