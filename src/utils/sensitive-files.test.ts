import { describe, expect, it } from "vitest";
import { isSensitiveFile } from "./sensitive-files.js";

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
