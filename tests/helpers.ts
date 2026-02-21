import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const TSX_BIN = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");
const CLI_ENTRY = path.join(PROJECT_ROOT, "src", "cli.ts");

export interface SuccessOutput {
  ok: true;
  filesModified: string[];
  summary: string;
}

export interface ErrorOutput {
  ok: false;
  error: string;
  message: string;
}

export type CliOutput = SuccessOutput | ErrorOutput;

/**
 * Copy a named fixture to a fresh temp directory and return its path.
 * Each test should call this to get an isolated, mutable copy.
 */
export function copyFixture(name: string): string {
  const src = path.join(PROJECT_ROOT, "tests", "fixtures", name);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), `ns-${name}-`));
  copyDirSync(src, dest);
  return dest;
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDirSync(s, d) : fs.copyFileSync(s, d);
  }
}

/**
 * Run the CLI with the given args. Any arg whose value ends in a known file
 * extension is resolved as a path relative to `dir`.
 *
 * Returns the parsed JSON output.
 */
export function runCli(dir: string, args: string[]): CliOutput {
  const resolvedArgs = args.map((arg) =>
    /\.(ts|tsx|js|jsx|vue)$/.test(arg) ? path.join(dir, arg) : arg,
  );

  const result = spawnSync(TSX_BIN, [CLI_ENTRY, ...resolvedArgs], {
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });

  const stdout = result.stdout?.trim();

  if (!stdout) {
    throw new Error(`CLI produced no output.\nstderr: ${result.stderr}\nstatus: ${result.status}`);
  }

  try {
    return JSON.parse(stdout) as CliOutput;
  } catch {
    throw new Error(`CLI produced non-JSON output:\n${stdout}\nstderr: ${result.stderr}`);
  }
}

/** Read a file relative to a fixture temp dir. */
export function readFile(dir: string, relative: string): string {
  return fs.readFileSync(path.join(dir, relative), "utf8");
}

/** Check whether a file exists relative to a fixture temp dir. */
export function fileExists(dir: string, relative: string): boolean {
  return fs.existsSync(path.join(dir, relative));
}

/** Delete a temp dir produced by copyFixture. */
export function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Spawn the CLI and wait for a `{ status: "ready" }` line on stderr.
 * Returns the ChildProcess so the caller can kill it in afterEach.
 * Rejects if the ready signal is not received within `timeoutMs`.
 */
export function spawnAndWaitForReady(args: string[], timeoutMs = 30_000): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [CLI_ENTRY, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });

    let stderrBuf = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out waiting for ready signal after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      for (const line of stderrBuf.split("\n")) {
        try {
          const msg = JSON.parse(line.trim());
          if (msg.status === "ready") {
            clearTimeout(timer);
            resolve(child);
          }
        } catch {
          // not JSON, ignore
        }
      }
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Process exited early with code ${code}`));
    });
  });
}
