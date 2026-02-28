import type { ChildProcess } from "node:child_process";
import { afterEach } from "vitest";
import { removeDaemonFiles } from "../src/daemon/daemon.js";
import { cleanup, copyFixture } from "./helpers.js";
import { killDaemon, spawnAndWaitForReady, waitForDaemon } from "./process-helpers.js";

/**
 * Minimal MCP client for testing. Handles Content-Length framing and the
 * initialize handshake. Use with a process spawned via spawnAndWaitForReady
 * with pipeStdin: true.
 */
export class McpTestClient {
  private buf = "";
  private pending: Array<(msg: Record<string, unknown>) => void> = [];

  constructor(private proc: ChildProcess) {
    // biome-ignore lint/style/noNonNullAssertion: stdout is always piped (spawnAndWaitForReady uses stdio: ['pipe','pipe','pipe'])
    proc.stdout!.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString();
      this.flush();
    });
  }

  private flush(): void {
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl === -1) break;
      const line = this.buf.slice(0, nl).replace(/\r$/, "");
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        // Skip notifications (no id field)
        if ("id" in msg) {
          const resolve = this.pending.shift();
          if (resolve) resolve(msg);
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  send(message: object): void {
    // biome-ignore lint/style/noNonNullAssertion: stdin is always piped when pipeStdin:true is passed to spawnAndWaitForReady
    this.proc.stdin!.write(`${JSON.stringify(message)}\n`);
  }

  receive(): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      this.pending.push(resolve);
      this.flush();
    });
  }

  async request(id: number, method: string, params?: unknown): Promise<Record<string, unknown>> {
    this.send({ jsonrpc: "2.0", id, method, params });
    return this.receive();
  }

  async initialize(): Promise<void> {
    await this.request(0, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    this.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  }
}

/**
 * Parse the JSON result from an MCP tool call response.
 * Extracts the text content and JSON.parses it.
 */
export function parseMcpResult(resp: Record<string, unknown>): Record<string, unknown> {
  const text = (resp.result as { content: { text: string }[] }).content[0].text;
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * Registers afterEach cleanup and returns a `setup` function for MCP integration tests.
 * Call once at the top of a `describe` block; `setup(fixture?)` starts the MCP server
 * for the given fixture and returns `{ dir, client }`.
 */
export function useMcpContext(): {
  setup: (fixture?: string) => Promise<{ dir: string; client: McpTestClient }>;
} {
  const dirs: string[] = [];
  const procs: ChildProcess[] = [];

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

  async function setup(fixture = "simple-ts"): Promise<{ dir: string; client: McpTestClient }> {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    const proc = await spawnAndWaitForReady(["serve", "--workspace", dir], { pipeStdin: true });
    procs.push(proc);
    await waitForDaemon(dir);
    const client = new McpTestClient(proc);
    await client.initialize();
    return { dir, client };
  }

  return { setup };
}
