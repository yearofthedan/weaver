import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer } from "../../eval/fixture-server.js";
import { PROTOCOL_VERSION } from "../../src/daemon/daemon.js";
import { lockfilePath, socketPath } from "../../src/daemon/paths.js";

function callSocket(sockPath: string, req: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(sockPath);
    let buf = "";
    socket.on("connect", () => socket.write(`${JSON.stringify(req)}\n`));
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        try {
          resolve(JSON.parse(buf.slice(0, nl)) as Record<string, unknown>);
        } catch (e) {
          reject(e);
        }
        socket.destroy();
      }
    });
    socket.on("error", reject);
  });
}

describe("startFixtureServer", () => {
  let workspace: string;
  let fixturesDir: string;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lb-fixture-srv-"));
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-fixtures-"));
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  });

  it("creates a socket file and lockfile at the workspace-derived paths", async () => {
    stop = await startFixtureServer(workspace, fixturesDir);

    expect(fs.existsSync(socketPath(workspace))).toBe(true);
    expect(fs.existsSync(lockfilePath(workspace))).toBe(true);
  });

  it("writes lockfile with the current process pid and a startedAt timestamp", async () => {
    const before = Date.now();
    stop = await startFixtureServer(workspace, fixturesDir);
    const after = Date.now();

    const raw = fs.readFileSync(lockfilePath(workspace), "utf8");
    const lock = JSON.parse(raw) as { pid: number; startedAt: number };

    // Fixture server runs in-process — pid must be exactly this process's pid.
    expect(lock.pid).toBe(process.pid);
    expect(lock.startedAt).toBeGreaterThanOrEqual(before);
    expect(lock.startedAt).toBeLessThanOrEqual(after);
  });

  it("responds to ping with ok:true and the current PROTOCOL_VERSION", async () => {
    stop = await startFixtureServer(workspace, fixturesDir);

    const resp = await callSocket(socketPath(workspace), { method: "ping", params: {} });

    // Must match the real daemon's ping response so ensureDaemon treats it as up-to-date.
    expect(resp).toEqual({ ok: true, version: PROTOCOL_VERSION });
  });

  it("returns the fixture file contents verbatim for a known method", async () => {
    const fixture = {
      ok: true,
      symbolName: "authenticate",
      references: [{ file: "/src/auth.ts", line: 5, col: 3, length: 12 }],
    };
    fs.writeFileSync(path.join(fixturesDir, "findReferences.json"), JSON.stringify(fixture));
    stop = await startFixtureServer(workspace, fixturesDir);

    const resp = await callSocket(socketPath(workspace), {
      method: "findReferences",
      params: { file: "/src/auth.ts", line: 5, col: 3 },
    });

    expect(resp).toEqual(fixture);
  });

  it("returns NOT_FOUND for a method that has no fixture file", async () => {
    stop = await startFixtureServer(workspace, fixturesDir);

    const resp = await callSocket(socketPath(workspace), {
      method: "noSuchMethod",
      params: {},
    });

    // Must not throw or hang — unknown method gets a structured error, not silence.
    expect(resp.ok).toBe(false);
    expect(resp.error).toBe("NOT_FOUND");
  });

  it("removes socket and lockfile when the returned stop function is called", async () => {
    stop = await startFixtureServer(workspace, fixturesDir);
    const sockPath = socketPath(workspace);
    const pidPath = lockfilePath(workspace);

    stop();
    stop = undefined;

    expect(fs.existsSync(sockPath)).toBe(false);
    expect(fs.existsSync(pidPath)).toBe(false);
  });
});
