import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMcpResult, useMcpContext } from "../__testHelpers__/mcp-helpers.js";
import { validateFilePath } from "../security.js";

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

describe("MCP transport — workspace security", () => {
  const { setup } = useMcpContext();

  it("rejects rename of a file outside the workspace", async () => {
    const { client } = await setup();

    const resp = await client.request(1, "tools/call", {
      name: "rename",
      arguments: {
        file: path.join(os.tmpdir(), "outside.ts"),
        line: 1,
        col: 1,
        newName: "hacked",
      },
    });

    const result = parseMcpResult(resp);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("WORKSPACE_VIOLATION");
  }, 60_000);

  it("rejects moveFile when oldPath is outside the workspace", async () => {
    const { dir, client } = await setup();

    const resp = await client.request(2, "tools/call", {
      name: "moveFile",
      arguments: {
        oldPath: path.join(os.tmpdir(), "outside.ts"),
        newPath: path.join(dir, "src/inside.ts"),
      },
    });

    const result = parseMcpResult(resp);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("WORKSPACE_VIOLATION");
  }, 60_000);

  it("rejects moveFile when newPath is outside the workspace", async () => {
    const { dir, client } = await setup();

    const resp = await client.request(3, "tools/call", {
      name: "moveFile",
      arguments: {
        oldPath: path.join(dir, "src/utils.ts"),
        newPath: path.join(os.tmpdir(), "stolen.ts"),
      },
    });

    const result = parseMcpResult(resp);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("WORKSPACE_VIOLATION");
  }, 60_000);

  it("rejects path traversal via relative segments", async () => {
    const { dir, client } = await setup();

    // Construct a path that starts inside workspace but traverses out
    const traversal = path.join(dir, "src", "..", "..", "..", "etc", "passwd");

    const resp = await client.request(4, "tools/call", {
      name: "rename",
      arguments: {
        file: traversal,
        line: 1,
        col: 1,
        newName: "hacked",
      },
    });

    const result = parseMcpResult(resp);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("WORKSPACE_VIOLATION");
  }, 60_000);

  it("rejects newName that is not a valid identifier", async () => {
    const { dir, client } = await setup();

    const resp = await client.request(5, "tools/call", {
      name: "rename",
      arguments: {
        file: path.join(dir, "src/utils.ts"),
        line: 1,
        col: 17,
        newName: "not-valid!",
      },
    });

    // MCP SDK returns an error response when Zod validation fails
    expect(resp.error ?? (resp.result as { isError?: boolean } | undefined)?.isError).toBeTruthy();
  }, 60_000);

  it("newline in file path does not inject a second daemon command", async () => {
    const { dir, client } = await setup();

    // A newline embedded in the file path would be a framing injection attempt.
    // JSON.stringify escapes it, so the daemon receives one request (not two).
    // We expect a single well-formed error response, not a hang or double response.
    const resp = await client.request(6, "tools/call", {
      name: "rename",
      arguments: {
        file: `${path.join(dir, "src/utils.ts")}\n{"method":"ping"}`,
        line: 1,
        col: 1,
        newName: "safe",
      },
    });

    // Should get exactly one response (WORKSPACE_VIOLATION or FILE_NOT_FOUND),
    // demonstrating the newline was escaped and only one request reached the daemon.
    const result = parseMcpResult(resp);
    expect(result.ok).toBe(false);

    // Daemon is still alive and responsive after the attempt
    const followUp = await client.request(7, "tools/call", {
      name: "rename",
      arguments: {
        file: path.join(dir, "src/utils.ts"),
        line: 1,
        col: 17,
        newName: "greetPerson",
      },
    });
    expect(parseMcpResult(followUp).ok).toBe(true);
  }, 60_000);
});
