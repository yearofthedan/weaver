import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callDaemonForTest } from "./mcp.js";

let sockPath: string;
let server: net.Server;
const serverSockets = new Set<net.Socket>();

function createHungServer(): Promise<void> {
  return new Promise((resolve) => {
    server = net.createServer((conn) => {
      serverSockets.add(conn);
      conn.on("close", () => serverSockets.delete(conn));
      // Never writes back — simulates a hung daemon.
    });
    server.listen(sockPath, resolve);
  });
}

async function closeServer(): Promise<void> {
  for (const s of serverSockets) s.destroy();
  serverSockets.clear();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

beforeEach(async () => {
  sockPath = path.join(os.tmpdir(), `test-daemon-${process.pid}-${Date.now()}.sock`);
  await createHungServer();
});

afterEach(async () => {
  await closeServer();
  if (fs.existsSync(sockPath)) fs.unlinkSync(sockPath);
});

describe("callDaemon timeout", () => {
  it("rejects when the daemon never responds within the timeout", async () => {
    await expect(callDaemonForTest(sockPath, { method: "rename", params: {} }, 50)).rejects.toThrow(
      /timed out/i,
    );
  });

  it("resolves normally when the daemon responds in time", async () => {
    // Replace the hung server with one that echoes back immediately.
    await closeServer();
    if (fs.existsSync(sockPath)) fs.unlinkSync(sockPath);

    const response = { ok: true, filesModified: [] };

    await new Promise<void>((resolve) => {
      server = net.createServer((conn) => {
        serverSockets.add(conn);
        conn.on("close", () => serverSockets.delete(conn));
        conn.once("data", () => {
          conn.write(`${JSON.stringify(response)}\n`);
        });
      });
      server.listen(sockPath, resolve);
    });

    await expect(
      callDaemonForTest(sockPath, { method: "rename", params: {} }, 1000),
    ).resolves.toEqual(response);
  });
});
