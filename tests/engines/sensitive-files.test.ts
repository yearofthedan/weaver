import { describe, expect, it } from "vitest";
import { isSensitiveFile } from "../../src/security.js";

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
});
