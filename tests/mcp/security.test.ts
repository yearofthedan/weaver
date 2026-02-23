import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeDaemonFiles } from "../../src/daemon/daemon";
import {
  cleanup,
  copyFixture,
  killDaemon,
  McpTestClient,
  spawnAndWaitForReady,
  waitForDaemon,
} from "../helpers";

describe("MCP transport — workspace security", () => {
  const dirs: string[] = [];
  const procs: import("node:child_process").ChildProcess[] = [];

  afterEach(() => {
    for (const proc of procs.splice(0)) {
      if (!proc.killed) proc.kill();
    }
    for (const dir of dirs.splice(0)) {
      killDaemon(dir);
      removeDaemonFiles(dir);
      cleanup(dir);
    }
  });

  async function setup() {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    const proc = await spawnAndWaitForReady(["serve", "--workspace", dir], { pipeStdin: true });
    procs.push(proc);
    await waitForDaemon(dir);
    const client = new McpTestClient(proc);
    await client.initialize();
    return { dir, client };
  }

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

    const text = (resp.result as { content: { text: string }[] }).content[0].text;
    const result = JSON.parse(text);
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

    const text = (resp.result as { content: { text: string }[] }).content[0].text;
    const result = JSON.parse(text);
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

    const text = (resp.result as { content: { text: string }[] }).content[0].text;
    const result = JSON.parse(text);
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

    const text = (resp.result as { content: { text: string }[] }).content[0].text;
    const result = JSON.parse(text);
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
    const text = (resp.result as { content: { text: string }[] }).content[0].text;
    const result = JSON.parse(text);
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
    const followText = (followUp.result as { content: { text: string }[] }).content[0].text;
    expect(JSON.parse(followText).ok).toBe(true);
  }, 60_000);
});
