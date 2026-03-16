import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../../src/__testHelpers__/helpers.js";
import { isDaemonAlive, removeDaemonFiles } from "../../src/daemon/daemon";
import { lockfilePath, socketPath } from "../../src/daemon/paths";
import { McpTestClient } from "../../src/__testHelpers__/mcp-helpers.js";
import { killDaemon, spawnAndWaitForReady, waitForDaemon } from "../../src/__testHelpers__/process-helpers.js";

describe("serve command — daemon integration", () => {
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
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    return dir;
  }

  it("auto-spawns a daemon and becomes ready", async () => {
    const dir = await setup();
    const proc = await spawnAndWaitForReady(["serve", "--workspace", dir]);
    procs.push(proc);

    await waitForDaemon(dir);
    expect(fs.existsSync(socketPath(dir))).toBe(true);
    expect(isDaemonAlive(dir)).toBe(true);
  });

  it("connects to an already-running daemon without spawning a second one", async () => {
    const dir = await setup();

    // Start the daemon explicitly first
    const daemon = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(daemon);
    const firstPid = parseInt(fs.readFileSync(lockfilePath(dir), "utf8").trim(), 10);

    // Now start serve — it should reuse the existing daemon
    const serve = await spawnAndWaitForReady(["serve", "--workspace", dir]);
    procs.push(serve);
    const secondPid = parseInt(fs.readFileSync(lockfilePath(dir), "utf8").trim(), 10);

    expect(secondPid).toBe(firstPid);
  });

  it("re-spawns the daemon if it dies after serve starts", async () => {
    const dir = await setup();
    const proc = await spawnAndWaitForReady(["serve", "--workspace", dir], { pipeStdin: true });
    procs.push(proc);
    await waitForDaemon(dir);

    // Kill the daemon — it cleans up its own socket/lockfile on SIGTERM
    killDaemon(dir);
    const deadline = Date.now() + 5_000;
    while (isDaemonAlive(dir) && Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 50));
    }

    // A tool call should trigger daemon re-spawn and succeed — not return DAEMON_STARTING
    const client = new McpTestClient(proc);
    await client.initialize();
    const resp = await client.request(1, "tools/call", {
      name: "findReferences",
      arguments: {
        file: path.join(dir, "src/utils.ts"),
        line: 1,
        col: 17,
      },
    });

    const result = JSON.parse((resp.result as { content: { text: string }[] }).content[0].text);
    expect(result.ok).toBe(true);
    expect(result.references).toBeDefined();
  }, 90_000);

  it("recovers from a stale socket and spawns a new daemon", async () => {
    const dir = await setup();

    // Write a stale socket and lockfile with a dead PID
    fs.mkdirSync(require("node:path").dirname(socketPath(dir)), { recursive: true });
    fs.writeFileSync(socketPath(dir), "");
    fs.writeFileSync(lockfilePath(dir), "999999999");

    const proc = await spawnAndWaitForReady(["serve", "--workspace", dir]);
    procs.push(proc);

    await waitForDaemon(dir);
    expect(fs.existsSync(socketPath(dir))).toBe(true);
    expect(isDaemonAlive(dir)).toBe(true);
  });
});
