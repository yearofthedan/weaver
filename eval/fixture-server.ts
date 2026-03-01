import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { PROTOCOL_VERSION } from "../src/daemon/daemon.js";
import { ensureCacheDir, lockfilePath, socketPath } from "../src/daemon/paths.js";

/**
 * Start a fixture socket server that impersonates the real daemon for eval runs.
 *
 * - Responds to `ping` with `{ ok: true, version: PROTOCOL_VERSION }` so that
 *   `ensureDaemon` accepts it as a live, up-to-date daemon.
 * - For any other method, looks up `{fixturesDir}/{method}.json` and returns its
 *   contents verbatim. Returns `{ ok: false, error: "NOT_FOUND" }` if no fixture
 *   file exists for that method.
 * - Writes the lockfile and socket at the paths derived from `workspace`, exactly
 *   as the real daemon does, so `isDaemonAlive` returns true.
 *
 * Returns a cleanup function: call it to close the server and remove the daemon
 * files. The caller must call it before the process exits.
 */
export async function startFixtureServer(
  workspace: string,
  fixturesDir: string,
): Promise<() => void> {
  ensureCacheDir();

  const sockPath = socketPath(workspace);
  const pidPath = lockfilePath(workspace);

  // Remove stale files from any previous run so server.listen() doesn't fail.
  for (const p of [sockPath, pidPath]) {
    try {
      fs.unlinkSync(p);
    } catch {
      // already gone
    }
  }

  // Write lockfile in the same format as the real daemon so isDaemonAlive returns true.
  fs.writeFileSync(pidPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));

  const server = net.createServer((socket) => {
    let buf = "";
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          handleRequest(socket, line.trim(), fixturesDir);
        }
      }
    });
    socket.on("error", () => {});
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(sockPath, resolve);
  });

  return () => {
    server.close();
    for (const p of [sockPath, pidPath]) {
      try {
        fs.unlinkSync(p);
      } catch {
        // already gone
      }
    }
  };
}

function handleRequest(socket: net.Socket, line: string, fixturesDir: string): void {
  let response: object;
  try {
    const req = JSON.parse(line) as { method?: string };
    const { method } = req;

    if (!method) {
      response = { ok: false, error: "PARSE_ERROR", message: "method is required" };
    } else if (method === "ping") {
      response = { ok: true, version: PROTOCOL_VERSION };
    } else {
      const fixturePath = path.join(fixturesDir, `${method}.json`);
      if (!fs.existsSync(fixturePath)) {
        response = { ok: false, error: "NOT_FOUND", message: `No fixture for method: ${method}` };
      } else {
        response = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as object;
      }
    }
  } catch {
    response = { ok: false, error: "PARSE_ERROR", message: "Invalid JSON" };
  }

  socket.write(`${JSON.stringify(response)}\n`);
}
