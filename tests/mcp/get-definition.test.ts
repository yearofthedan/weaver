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

describe("MCP transport — getDefinition tool", () => {
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

  it("resolves the definition of a symbol end-to-end via MCP", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);

    const proc = await spawnAndWaitForReady(["serve", "--workspace", dir], { pipeStdin: true });
    procs.push(proc);
    await waitForDaemon(dir);

    const client = new McpTestClient(proc);
    await client.initialize();

    // Call getDefinition on the greetUser call site in main.ts (line 3, col 13)
    const resp = await client.request(1, "tools/call", {
      name: "getDefinition",
      arguments: {
        file: path.join(dir, "src/main.ts"),
        line: 3,
        col: 13,
      },
    });

    const text = (resp.result as { content: { text: string }[] }).content[0].text;
    const result = JSON.parse(text);

    expect(result.ok).toBe(true);
    expect(result.symbolName).toBe("greetUser");
    expect(result.definitions.length).toBeGreaterThanOrEqual(1);
    // Definition must point back to utils.ts
    expect(result.definitions.some((d: { file: string }) => d.file.endsWith("utils.ts"))).toBe(
      true,
    );
  }, 60_000);
});
