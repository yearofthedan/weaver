import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeDaemonFiles } from "../../src/daemon/paths";
import { McpTestClient, cleanup, copyFixture, killDaemon, readFile, spawnAndWaitForReady, waitForDaemon } from "../helpers";

describe("MCP transport — rename tool", () => {
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

  it("renames a symbol end-to-end via MCP", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);

    // Verify fixture starts with the original name
    expect(readFile(dir, "src/utils.ts")).toContain("greetUser");
    expect(readFile(dir, "src/main.ts")).toContain("greetUser");

    const proc = await spawnAndWaitForReady(["serve", "--workspace", dir], { pipeStdin: true });
    procs.push(proc);
    await waitForDaemon(dir);

    const client = new McpTestClient(proc);
    await client.initialize();

    const resp = await client.request(1, "tools/call", {
      name: "rename",
      arguments: {
        file: path.join(dir, "src/utils.ts"),
        line: 1,
        col: 17,
        newName: "greetPerson",
      },
    });

    const text = (resp.result as { content: { text: string }[] }).content[0].text;
    const result = JSON.parse(text);

    expect(result.ok).toBe(true);
    expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
    expect(readFile(dir, "src/utils.ts")).toContain("greetPerson");
    expect(readFile(dir, "src/main.ts")).not.toContain("greetUser");
    expect(readFile(dir, "src/main.ts")).toContain("greetPerson");
  }, 60_000);
});
