import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { afterEach, describe, expect } from "vitest";
import {
  FIXTURES,
  type FixtureName,
  readFile,
  fixtureTest as test,
} from "../__testHelpers__/helpers.js";
import {
  callDaemonSocket,
  killDaemon,
  spawnAndWaitForReady,
} from "../__testHelpers__/process-helpers.js";
import { removeDaemonFiles } from "./daemon.js";
import { lockfilePath, socketPath } from "./paths.js";

function sendRawToSocket(dir: string, raw: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath(dir));
    let buf = "";
    socket.on("connect", () => {
      socket.write(`${raw}\n`);
    });
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

const WORKSPACE_FIXTURE = FIXTURES.simpleTs.name;

describe("daemon command", () => {
  const dirs: string[] = [];
  const procs: import("node:child_process").ChildProcess[] = [];

  afterEach(() => {
    for (const proc of procs.splice(0)) {
      if (!proc.killed) proc.kill();
    }
    for (const dir of dirs.splice(0)) {
      killDaemon(dir);
      removeDaemonFiles(dir);
    }
  });

  async function setup(seedNamedFixture: (name: FixtureName) => Promise<string>) {
    const dir = await seedNamedFixture(WORKSPACE_FIXTURE);
    dirs.push(dir);
    return dir;
  }

  test("writes a socket file after becoming ready", async ({ seedNamedFixture }) => {
    const dir = await setup(seedNamedFixture);
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    expect(fs.existsSync(socketPath(dir))).toBe(true);
  });

  test("writes a lockfile containing a live PID and a startedAt timestamp", async ({
    seedNamedFixture,
  }) => {
    const dir = await setup(seedNamedFixture);
    const before = Date.now();
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);
    const after = Date.now();

    // tsx spawns a child process, so proc.pid is the tsx wrapper — not the
    // inner daemon process. Verify the lockfile PID is a live process instead.
    const raw = fs.readFileSync(lockfilePath(dir), "utf8");
    const lock = JSON.parse(raw) as { pid: number; startedAt: number };
    expect(Number.isNaN(lock.pid)).toBe(false);
    expect(() => process.kill(lock.pid, 0)).not.toThrow();
    expect(lock.startedAt).toBeGreaterThanOrEqual(before);
    expect(lock.startedAt).toBeLessThanOrEqual(after);
  });

  test("isDaemonAlive returns false when socket file is missing even if lockfile exists", async ({
    seedNamedFixture,
  }) => {
    const dir = await setup(seedNamedFixture);
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    // Remove the socket file while the daemon is still running (simulates
    // a PID-recycled scenario: lockfile present, PID alive, but no socket).
    fs.unlinkSync(socketPath(dir));

    const { isDaemonAlive } = await import("./daemon.js");
    expect(isDaemonAlive(dir)).toBe(false);
  });

  test("picks up a new source file added out-of-band via the watcher", async ({
    seedNamedFixture,
  }) => {
    const dir = await setup(seedNamedFixture);
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    // Add a new file that imports greetUser — outside any daemon operation
    const newFile = path.join(dir, "src", "consumer.ts");
    fs.writeFileSync(
      newFile,
      'import { greetUser } from "./utils";\nexport const msg = greetUser("test");\n',
    );

    // Wait for watcher debounce (200ms) + rebuild margin
    await new Promise((resolve) => setTimeout(resolve, 600));

    // findReferences on greetUser (line 1, col 17 in utils.ts)
    const utilsPath = path.join(dir, "src", "utils.ts");
    const response = await callDaemonSocket(dir, {
      method: "findReferences",
      params: { file: utilsPath, line: 1, col: 17 },
    });

    expect(response.status).toBe("success");
    const refs = (response as { references: Array<{ file: string }> }).references;
    expect(refs.some((r) => r.file === newFile)).toBe(true);
  });

  test("killDaemon terminates the inner node process", async ({ seedNamedFixture }) => {
    const dir = await setup(seedNamedFixture);
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    const raw = fs.readFileSync(lockfilePath(dir), "utf8");
    const { pid } = JSON.parse(raw) as { pid: number; startedAt: number };
    expect(() => process.kill(pid, 0)).not.toThrow(); // sanity: process is alive

    killDaemon(dir);

    await new Promise((r) => setTimeout(r, 300));

    expect(() => process.kill(pid, 0)).toThrow(); // inner node process is gone
  });

  test("removes socket and lockfile on SIGTERM", async ({ seedNamedFixture }) => {
    const dir = await setup(seedNamedFixture);
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    const raw = fs.readFileSync(lockfilePath(dir), "utf8");
    const { pid } = JSON.parse(raw) as { pid: number };
    process.kill(pid, "SIGTERM");

    const deadline = Date.now() + 5_000;
    while (fs.existsSync(socketPath(dir)) || fs.existsSync(lockfilePath(dir))) {
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(fs.existsSync(socketPath(dir))).toBe(false);
    expect(fs.existsSync(lockfilePath(dir))).toBe(false);
  });

  describe("PARSE_ERROR for valid JSON that fails envelope validation", () => {
    test.for([
      ["empty method string", { method: "", params: {} }],
      ["params is not an object", { method: "rename", params: "not-an-object" }],
    ] as const)("%s returns PARSE_ERROR", async ([, req], { seedNamedFixture }) => {
      const dir = await setup(seedNamedFixture);
      const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
      procs.push(proc);

      const response = await callDaemonSocket(
        dir,
        req as { method: string; params: Record<string, unknown> },
      );
      expect(response).toMatchObject({ status: "error", error: "PARSE_ERROR" });
    });
  });

  test("returns PARSE_ERROR for invalid JSON (SyntaxError) and INTERNAL_ERROR for other unexpected errors", async ({
    seedNamedFixture,
  }) => {
    const dir = await setup(seedNamedFixture);
    const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
    procs.push(proc);

    // Invalid JSON causes JSON.parse to throw a SyntaxError — that's a genuine parse
    // error, so the daemon returns PARSE_ERROR (not INTERNAL_ERROR).
    const response = await sendRawToSocket(dir, "not valid json {{{");
    expect(response).toMatchObject({ status: "error", error: "PARSE_ERROR" });
    expect(typeof response.message).toBe("string");
    expect((response.message as string).length).toBeGreaterThan(0);
  });

  describe("project structure changing mid-session", () => {
    test("a tsconfig added after the first request governs the next request's diagnostics", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "src/greet.ts": "export function greet(name) {\n  return 'hi ' + name;\n}\n",
      });
      dirs.push(dir);
      const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
      procs.push(proc);

      const file = path.join(dir, "src", "greet.ts");

      // With no tsconfig.json, the ts-morph fallback project has no `strict` setting
      // at all — TypeScript treats an absent `strict` as on for individual flags like
      // `noImplicitAny`, so the implicit-any parameter is already flagged here. Adding
      // a tsconfig that explicitly turns `strict` off is what makes the diagnostic
      // disappear, proving the *compiler options* were re-read, not just the file set.
      const before = await callDaemonSocket(dir, { method: "getTypeErrors", params: { file } });
      expect(before.status).toBe("success");
      expect((before.diagnostics as Array<{ code: number }>).map((d) => d.code)).toContain(7006);

      fs.writeFileSync(
        path.join(dir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: false }, include: ["src/**/*.ts"] }),
      );

      const after = await callDaemonSocket(dir, { method: "getTypeErrors", params: { file } });
      expect(after.status).toBe("success");
      expect((after.diagnostics as Array<{ code: number }>).map((d) => d.code)).not.toContain(7006);
    });

    test("a tsconfig deleted after the first request does not fail the next request", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({ compilerOptions: { strict: false } }),
        "src/greet.ts": "export function greet(name) {\n  return 'hi ' + name;\n}\n",
      });
      dirs.push(dir);
      const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
      procs.push(proc);

      const file = path.join(dir, "src", "greet.ts");

      const before = await callDaemonSocket(dir, { method: "getTypeErrors", params: { file } });
      expect(before.status).toBe("success");
      expect((before.diagnostics as Array<{ code: number }>).map((d) => d.code)).not.toContain(
        7006,
      );

      fs.unlinkSync(path.join(dir, "tsconfig.json"));

      // No config on disk falls back to ts-morph's no-tsconfig project, whose absent
      // `strict` setting TypeScript treats as on — the missing file must not cause an
      // error response, even though the diagnostic result now differs from `before`.
      const after = await callDaemonSocket(dir, { method: "getTypeErrors", params: { file } });
      expect(after.status).toBe("success");
      expect(after.error).toBeUndefined();
      expect((after.diagnostics as Array<{ code: number }>).map((d) => d.code)).toContain(7006);
    });

    test("a tsconfig added nearer a file than the previously resolved one takes over", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: false },
          include: ["packages/**/*.ts"],
        }),
        "packages/app/src/greet.ts": "export function greet(name) {\n  return 'hi ' + name;\n}\n",
      });
      dirs.push(dir);
      const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
      procs.push(proc);

      const file = path.join(dir, "packages", "app", "src", "greet.ts");

      const before = await callDaemonSocket(dir, { method: "getTypeErrors", params: { file } });
      expect(before.status).toBe("success");
      expect((before.diagnostics as Array<{ code: number }>).map((d) => d.code)).not.toContain(
        7006,
      );

      fs.writeFileSync(
        path.join(dir, "packages", "app", "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }),
      );

      const after = await callDaemonSocket(dir, { method: "getTypeErrors", params: { file } });
      expect(after.status).toBe("success");
      expect((after.diagnostics as Array<{ code: number }>).map((d) => d.code)).toContain(7006);
    });

    test("a project that gains its first .vue file gets Vue-aware renames", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, moduleResolution: "bundler" },
          include: ["src/**/*.ts", "src/**/*.vue"],
        }),
        "src/utils.ts":
          // biome-ignore lint/suspicious/noTemplateCurlyInString: file content intentionally contains a template literal
          "export function greetUser(name: string): string {\n  return `Hello, ${name}`;\n}\n",
      });
      dirs.push(dir);
      const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
      procs.push(proc);

      const utilsFile = path.join(dir, "src", "utils.ts");

      // Serve one request while the project has no .vue files, so engine selection
      // has already run at least once against a TS-only structure.
      const before = await callDaemonSocket(dir, {
        method: "getTypeErrors",
        params: { file: utilsFile },
      });
      expect(before.status).toBe("success");

      const vueFile = path.join(dir, "src", "App.vue");
      fs.writeFileSync(
        vueFile,
        '<script setup lang="ts">\nimport { greetUser } from "./utils";\n\nconst message = greetUser("world");\n</script>\n\n<template>\n  <div>{{ message }}</div>\n</template>\n',
      );

      // Wait for watcher debounce (200ms) + rebuild margin
      await new Promise((resolve) => setTimeout(resolve, 600));

      const result = await callDaemonSocket(dir, {
        method: "rename",
        params: { file: utilsFile, line: 1, col: 17, newName: "welcomeUser" },
      });

      expect(result.status).toBe("success");
      expect(result.filesModified).toContain(vueFile);
      const vueContent = readFile(dir, "src/App.vue");
      expect(vueContent).toContain("welcomeUser");
      expect(vueContent).not.toContain("greetUser");
    });

    test("edits to a .vue file added after startup are observed", async ({ seedInlineFixture }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, moduleResolution: "bundler" },
          include: ["src/**/*.ts", "src/**/*.vue"],
        }),
        "src/utils.ts":
          // biome-ignore lint/suspicious/noTemplateCurlyInString: file content intentionally contains a template literal
          "export function greetUser(name: string): string {\n  return `Hello, ${name}`;\n}\n",
      });
      dirs.push(dir);
      const proc = await spawnAndWaitForReady(["daemon", "--workspace", dir]);
      procs.push(proc);

      const utilsFile = path.join(dir, "src", "utils.ts");

      // Serve one request while the project has no .vue files.
      const before = await callDaemonSocket(dir, {
        method: "findReferences",
        params: { file: utilsFile, line: 1, col: 17 },
      });
      expect(before.status).toBe("success");

      const vueFile = path.join(dir, "src", "App.vue");
      fs.writeFileSync(
        vueFile,
        '<script setup lang="ts">\nimport { greetUser } from "./utils";\n\nconst message = greetUser("world");\n</script>\n\n<template>\n  <div>{{ message }}</div>\n</template>\n',
      );

      await new Promise((resolve) => setTimeout(resolve, 600));

      const afterAdd = await callDaemonSocket(dir, {
        method: "findReferences",
        params: { file: utilsFile, line: 1, col: 17 },
      });
      expect(afterAdd.status).toBe("success");
      const refsAfterAdd = (afterAdd as { references: Array<{ file: string }> }).references;
      expect(refsAfterAdd.some((r) => r.file === vueFile)).toBe(true);

      // Edit the .vue file's content on disk after the daemon has already
      // read it once — the removed usage must be observed on the next
      // request rather than served from the content read at add time.
      fs.writeFileSync(
        vueFile,
        '<script setup lang="ts">\nconst message = "static";\n</script>\n\n<template>\n  <div>{{ message }}</div>\n</template>\n',
      );

      await new Promise((resolve) => setTimeout(resolve, 600));

      const afterEdit = await callDaemonSocket(dir, {
        method: "findReferences",
        params: { file: utilsFile, line: 1, col: 17 },
      });
      expect(afterEdit.status).toBe("success");
      const refsAfterEdit = (afterEdit as { references: Array<{ file: string }> }).references;
      expect(refsAfterEdit.some((r) => r.file === vueFile)).toBe(false);
    });
  });
});
