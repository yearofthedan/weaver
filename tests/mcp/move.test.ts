import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeDaemonFiles } from "../../src/daemon/daemon";
import {
  cleanup,
  copyFixture,
  killDaemon,
  McpTestClient,
  readFile,
  spawnAndWaitForReady,
  waitForDaemon,
} from "../helpers";

describe("MCP transport — move tool", () => {
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

  it("moves a file end-to-end via MCP and updates import paths", async () => {
    const dir = copyFixture("multi-importer");
    dirs.push(dir);

    // Verify fixture starts with the original import path
    expect(readFile(dir, "src/featureA.ts")).toContain("./utils");
    expect(readFile(dir, "src/featureB.ts")).toContain("./utils");

    const proc = await spawnAndWaitForReady(["serve", "--workspace", dir], { pipeStdin: true });
    procs.push(proc);
    await waitForDaemon(dir);

    const client = new McpTestClient(proc);
    await client.initialize();

    const oldPath = path.join(dir, "src/utils.ts");
    const newPath = path.join(dir, "src/helpers.ts");

    const resp = await client.request(1, "tools/call", {
      name: "move",
      arguments: { oldPath, newPath },
    });

    const text = (resp.result as { content: { text: string }[] }).content[0].text;
    const result = JSON.parse(text);

    expect(result.ok).toBe(true);
    expect(readFile(dir, "src/featureA.ts")).not.toContain("./utils");
    expect(readFile(dir, "src/featureA.ts")).toContain("./helpers");
    expect(readFile(dir, "src/featureB.ts")).not.toContain("./utils");
    expect(readFile(dir, "src/featureB.ts")).toContain("./helpers");
  }, 60_000);
});
