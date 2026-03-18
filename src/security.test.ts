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
  it("blocks .env files", () => {
    expect(isSensitiveFile("/workspace/.env")).toBe(true);
  });

  it("blocks .env.local and other .env variants", () => {
    expect(isSensitiveFile("/workspace/.env.local")).toBe(true);
    expect(isSensitiveFile("/workspace/.env.production")).toBe(true);
    expect(isSensitiveFile("/workspace/src/.env.test")).toBe(true);
  });

  it("blocks PEM certificate files", () => {
    expect(isSensitiveFile("/workspace/cert.pem")).toBe(true);
    expect(isSensitiveFile("/certs/server.pem")).toBe(true);
  });

  it("blocks private key files", () => {
    expect(isSensitiveFile("/workspace/private.key")).toBe(true);
    expect(isSensitiveFile("/home/user/.ssh/id_rsa")).toBe(true);
    expect(isSensitiveFile("/home/user/.ssh/id_ecdsa")).toBe(true);
    expect(isSensitiveFile("/home/user/.ssh/id_ed25519")).toBe(true);
    expect(isSensitiveFile("/home/user/.ssh/id_dsa")).toBe(true);
  });

  it("blocks PKCS12 keystores", () => {
    expect(isSensitiveFile("/workspace/keystore.p12")).toBe(true);
    expect(isSensitiveFile("/workspace/keystore.pfx")).toBe(true);
  });

  it("blocks Java keystores", () => {
    expect(isSensitiveFile("/workspace/app.jks")).toBe(true);
    expect(isSensitiveFile("/workspace/app.keystore")).toBe(true);
  });

  it("blocks certificate files", () => {
    expect(isSensitiveFile("/workspace/server.cert")).toBe(true);
    expect(isSensitiveFile("/workspace/server.crt")).toBe(true);
  });

  it("blocks AWS and cloud credential files", () => {
    expect(isSensitiveFile("/home/user/.aws/credentials")).toBe(true);
    expect(isSensitiveFile("/workspace/credentials")).toBe(true);
    expect(isSensitiveFile("/workspace/.credentials")).toBe(true);
  });

  it("blocks SSH known_hosts and authorized_keys", () => {
    expect(isSensitiveFile("/home/user/.ssh/known_hosts")).toBe(true);
    expect(isSensitiveFile("/home/user/.ssh/authorized_keys")).toBe(true);
  });

  it("allows normal source files", () => {
    expect(isSensitiveFile("/workspace/src/utils.ts")).toBe(false);
    expect(isSensitiveFile("/workspace/src/App.vue")).toBe(false);
    expect(isSensitiveFile("/workspace/package.json")).toBe(false);
    expect(isSensitiveFile("/workspace/README.md")).toBe(false);
    expect(isSensitiveFile("/workspace/.gitignore")).toBe(false);
  });

  it("allows files that merely contain env-like words in their name", () => {
    expect(isSensitiveFile("/workspace/src/environment.ts")).toBe(false);
    expect(isSensitiveFile("/workspace/src/keyUtils.ts")).toBe(false);
  });

  it("does not block files whose name merely ends with .env (^ anchor must hold)", () => {
    // Dropping the ^ from /^\.env($|\.|_)/ would match mid-filename occurrences
    // like config.env or template.env — these should NOT be blocked.
    expect(isSensitiveFile("/workspace/config.env")).toBe(false);
    expect(isSensitiveFile("/workspace/template.env")).toBe(false);
    expect(isSensitiveFile("/workspace/myapp.env")).toBe(false);
  });

  it("blocks npm and HTTP credential files", () => {
    expect(isSensitiveFile("/workspace/.npmrc")).toBe(true);
    expect(isSensitiveFile("/home/user/.npmrc")).toBe(true);
    expect(isSensitiveFile("/home/user/.netrc")).toBe(true);
  });

  it("blocks direnv shell-variable files", () => {
    expect(isSensitiveFile("/workspace/.envrc")).toBe(true);
    expect(isSensitiveFile("/home/user/project/.envrc")).toBe(true);
  });

  it("blocks HashiCorp Vault token file", () => {
    expect(isSensitiveFile("/home/user/.vault-token")).toBe(true);
  });

  it("blocks htpasswd files", () => {
    expect(isSensitiveFile("/workspace/.htpasswd")).toBe(true);
  });

  it("blocks secrets YAML files", () => {
    expect(isSensitiveFile("/workspace/secrets.yaml")).toBe(true);
    expect(isSensitiveFile("/workspace/secrets.yml")).toBe(true);
  });

  it("blocks KeePass database files", () => {
    expect(isSensitiveFile("/workspace/passwords.kdbx")).toBe(true);
  });

  it("blocks GCP and AWS service account key files", () => {
    expect(isSensitiveFile("/workspace/service-account.json")).toBe(true);
    expect(isSensitiveFile("/workspace/service-account-prod.json")).toBe(true);
    expect(isSensitiveFile("/workspace/my-app-key.json")).toBe(true);
    expect(isSensitiveFile("/workspace/firebase-key.json")).toBe(true);
  });

  it("does not block ordinary JSON files", () => {
    expect(isSensitiveFile("/workspace/package.json")).toBe(false);
    expect(isSensitiveFile("/workspace/tsconfig.json")).toBe(false);
    expect(isSensitiveFile("/workspace/monkey.json")).toBe(false);
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

  it("returns true for a path inside the workspace", () => {
    expect(isWithinWorkspace("/tmp/my-workspace/src/foo.ts", ws)).toBe(true);
  });

  it("returns true for a path equal to the workspace root", () => {
    expect(isWithinWorkspace("/tmp/my-workspace", ws)).toBe(true);
  });

  it("returns false for a sibling directory that shares the workspace prefix", () => {
    expect(isWithinWorkspace("/tmp/my-workspace-other/file.ts", ws)).toBe(false);
  });

  it("returns false for a path in a completely different directory", () => {
    expect(isWithinWorkspace("/tmp/other/file.ts", ws)).toBe(false);
  });

  it("returns false for a path that resolves outside via ..", () => {
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
