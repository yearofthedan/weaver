import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isSensitiveFile,
  isWithinWorkspace,
  validateFilePath,
  validateWorkspace,
} from "./security.js";

describe("validateFilePath", () => {
  it.each([
    ["null byte (\\x00)", "/workspace/src/foo\x00bar.ts"],
    ["newline (\\n)", "/workspace/src/foo\nbar.ts"],
    ["unit separator (\\x1f)", "/workspace/src/foo\x1fbar.ts"],
  ])("rejects a path containing a control character — %s", (_label, filePath) => {
    const result = validateFilePath(filePath);
    expect(result).toEqual({ ok: false, reason: "CONTROL_CHARS" });
  });

  it.each([
    ["question mark (URI query)", "/workspace/src/foo.ts?v=1"],
    ["hash (URI fragment)", "/workspace/src/foo.ts#anchor"],
  ])("rejects a path containing a URI special character — %s", (_label, filePath) => {
    const result = validateFilePath(filePath);
    expect(result).toEqual({ ok: false, reason: "URI_FRAGMENT" });
  });

  it.each([
    ["plain absolute path", "/workspace/src/foo.ts"],
    ["path with spaces and unicode", "/workspace/src/my file (v2) — naïve.ts"],
    ["path with hyphens and parentheses", "/workspace/src/my-module (copy).ts"],
  ])("accepts a valid path — %s", (_label, filePath) => {
    const result = validateFilePath(filePath);
    expect(result).toEqual({ ok: true });
  });

  it("returns { ok: false } for a null-byte path without throwing", () => {
    // Verifies validateFilePath runs before path.resolve() — path.resolve() with
    // a null byte throws an ERR_INVALID_ARG_VALUE on Node.js 18+.
    const filePath = "/workspace/src/foo\x00bar.ts";
    let result: ReturnType<typeof validateFilePath> | undefined;
    expect(() => {
      result = validateFilePath(filePath);
    }).not.toThrow();
    expect(result).toMatchObject({ ok: false });
  });
});

describe("isSensitiveFile", () => {
  it.each([
    "/workspace/.env",
    "/workspace/.env.local",
    "/workspace/.env.production",
    "/workspace/src/.env.test",
    "/workspace/cert.pem",
    "/certs/server.pem",
    "/workspace/private.key",
    "/home/user/.ssh/id_rsa",
    "/home/user/.ssh/id_ecdsa",
    "/home/user/.ssh/id_ed25519",
    "/home/user/.ssh/id_dsa",
    "/workspace/keystore.p12",
    "/workspace/keystore.pfx",
    "/workspace/app.jks",
    "/workspace/app.keystore",
    "/workspace/server.cert",
    "/workspace/server.crt",
    "/home/user/.aws/credentials",
    "/workspace/credentials",
    "/workspace/.credentials",
    "/home/user/.ssh/known_hosts",
    "/home/user/.ssh/authorized_keys",
    "/workspace/.npmrc",
    "/home/user/.npmrc",
    "/home/user/.netrc",
    "/workspace/.envrc",
    "/home/user/project/.envrc",
    "/home/user/.vault-token",
    "/workspace/.htpasswd",
    "/workspace/secrets.yaml",
    "/workspace/secrets.yml",
    "/workspace/passwords.kdbx",
    "/workspace/service-account.json",
    "/workspace/service-account-prod.json",
    "/workspace/my-app-key.json",
    "/workspace/firebase-key.json",
  ])("blocks %s", (filePath) => {
    expect(isSensitiveFile(filePath)).toBe(true);
  });

  it.each([
    "/workspace/src/utils.ts",
    "/workspace/src/App.vue",
    "/workspace/package.json",
    "/workspace/README.md",
    "/workspace/.gitignore",
    // Files that merely contain env-like words in their name
    "/workspace/src/environment.ts",
    "/workspace/src/keyUtils.ts",
    // Files ending with .env but without the leading dot (^ anchor pins the pattern
    // start: dropping it would match mid-filename occurrences like config.env)
    "/workspace/config.env",
    "/workspace/template.env",
    "/workspace/myapp.env",
    // Ordinary JSON files (not matching service-account key patterns)
    "/workspace/tsconfig.json",
    "/workspace/monkey.json",
  ])("allows %s", (filePath) => {
    expect(isSensitiveFile(filePath)).toBe(false);
  });
});

describe("isWithinWorkspace", () => {
  const ws = "/tmp/my-workspace";

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

  it.each([
    { filePath: "/tmp/my-workspace/src/foo.ts", expected: true, desc: "path inside workspace" },
    { filePath: "/tmp/my-workspace", expected: true, desc: "workspace root itself" },
    {
      filePath: "/tmp/my-workspace-other/file.ts",
      expected: false,
      desc: "sibling dir sharing the workspace prefix",
    },
    { filePath: "/tmp/other/file.ts", expected: false, desc: "completely different directory" },
    {
      filePath: "/tmp/my-workspace/../other/file.ts",
      expected: false,
      desc: "path escaping via ..",
    },
    { filePath: "/tmp/my-workspace/a/b/c/d/index.ts", expected: true, desc: "deeply nested path" },
    { filePath: "/tmp", expected: false, desc: "parent of the workspace" },
    { filePath: "/", expected: false, desc: "root path" },
    {
      filePath: "/tmp/my-workspace/src/index.ts",
      expected: true,
      desc: "path computed with path.join",
    },
  ])("$desc", ({ filePath, expected }) => {
    expect(isWithinWorkspace(filePath, ws)).toBe(expected);
  });

  it("returns false for a symlink inside the workspace that resolves outside", () => {
    const workspace = makeTmpDir();
    const outside = makeTmpDir();
    const outsideFile = path.join(outside, "secret.ts");
    fs.writeFileSync(outsideFile, "");
    const link = path.join(workspace, "escape.ts");
    fs.symlinkSync(outsideFile, link);
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
