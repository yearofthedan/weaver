import { describe, expect, it } from "vitest";
import { isSensitiveFile, isWithinWorkspace, validateFilePath } from "./security.js";

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
    "/workspace/src/environment.ts",
    "/workspace/src/keyUtils.ts",
    "/workspace/config.env",
    "/workspace/template.env",
    "/workspace/myapp.env",
    "/workspace/tsconfig.json",
    "/workspace/monkey.json",
    "/workspace/not-service-account.json",
    "/workspace/service-account.json.bak",
    "/workspace/app-key.json.bak",
  ])("allows %s", (filePath) => {
    expect(isSensitiveFile(filePath)).toBe(false);
  });
});

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

describe("isWithinWorkspace", () => {
  const ws = "/tmp/my-workspace";

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

  it("returns true for a lexically-inside path that does not exist on disk", () => {
    expect(isWithinWorkspace("/tmp/my-workspace/ghost/does-not-exist.ts", ws)).toBe(true);
  });

  it("workspace root itself equals the empty relative path (zero-length rel)", () => {
    expect(isWithinWorkspace(ws, ws)).toBe(true);
  });
});
