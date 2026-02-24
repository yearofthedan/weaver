/**
 * Minimal fake daemon for protocol version tests.
 * Listens on the real socket path and responds to every request with
 * { ok: true, version: <N> } where N comes from --version <N>.
 * Emits { status: "ready" } on stderr once the socket is open.
 *
 * Usage: tsx tests/fake-daemon.ts --workspace <dir> --version <N>
 */
import * as fs from "node:fs";
import * as net from "node:net";
import { ensureCacheDir, lockfilePath, socketPath } from "../src/daemon/paths.js";

const args = process.argv.slice(2);
const workspace = args[args.indexOf("--workspace") + 1];
const version = Number(args[args.indexOf("--version") + 1]);

if (!workspace || Number.isNaN(version)) {
  process.stderr.write("Usage: fake-daemon.ts --workspace <dir> --version <N>\n");
  process.exit(1);
}

ensureCacheDir();

const sockPath = socketPath(workspace);
const pidPath = lockfilePath(workspace);

fs.writeFileSync(pidPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));

const server = net.createServer((socket) => {
  let buf = "";
  socket.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        socket.write(`${JSON.stringify({ ok: true, version })}\n`);
      }
    }
  });
  socket.on("error", () => {});
});

server.listen(sockPath, () => {
  process.stderr.write(`${JSON.stringify({ status: "ready", workspace })}\n`);
});

function shutdown(): void {
  server.close();
  for (const p of [sockPath, pidPath]) {
    try {
      fs.unlinkSync(p);
    } catch {
      // already gone
    }
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
