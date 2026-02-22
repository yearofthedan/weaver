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

describe("MCP transport — moveSymbol tool", () => {
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

  it("moves a symbol end-to-end via MCP and updates import paths", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);

    // Verify fixture starts with greetUser in utils.ts
    expect(readFile(dir, "src/utils.ts")).toContain("greetUser");
    expect(readFile(dir, "src/main.ts")).toContain("./utils");

    const proc = await spawnAndWaitForReady(["serve", "--workspace", dir], { pipeStdin: true });
    procs.push(proc);
    await waitForDaemon(dir);

    const client = new McpTestClient(proc);
    await client.initialize();

    const sourceFile = path.join(dir, "src/utils.ts");
    const destFile = path.join(dir, "src/helpers.ts");

    const resp = await client.request(1, "tools/call", {
      name: "moveSymbol",
      arguments: { sourceFile, symbolName: "greetUser", destFile },
    });

    const text = (resp.result as { content: { text: string }[] }).content[0].text;
    const result = JSON.parse(text);

    expect(result.ok).toBe(true);

    // Symbol moved to dest file
    expect(readFile(dir, "src/helpers.ts")).toContain("greetUser");
    // Symbol removed from source file
    expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
    // main.ts import updated to point at helpers
    const mainContent = readFile(dir, "src/main.ts");
    expect(mainContent).toContain("./helpers");
    expect(mainContent).not.toContain("./utils");
  }, 60_000);
});
