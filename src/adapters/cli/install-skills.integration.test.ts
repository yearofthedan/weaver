import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROJECT_ROOT } from "../../__testHelpers__/helpers.js";

const CLI_DIST = path.join(PROJECT_ROOT, "dist", "adapters", "cli", "cli.js");
const SKILLS_SRC = path.join(PROJECT_ROOT, ".claude", "skills");
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, "package.json");

// The real shipped set is the package.json "files" manifest filtered to skills —
// not every directory under .claude/skills (which also holds dev-only skills).
function shippedSkillNames(): string[] {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8")) as { files?: string[] };
  return (pkg.files ?? [])
    .filter((entry) => entry.startsWith(".claude/skills/"))
    .map((entry) => path.basename(entry));
}

function runBuiltCliCommand(
  args: string[],
  timeoutMs = 15_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_DIST, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("skills install — integration smoke", () => {
  let tempDir: string;
  let installDir: string;

  beforeAll(() => {
    // The integration test requires a built dist. Build is run via pnpm check
    // before this suite executes; the dist must already exist.
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weaver-skills-"));
    // Install into a nested path that does not yet exist, mirroring the real
    // default (<cwd>/.claude/skills). This exercises recursive directory
    // creation — without it the spawned CLI would fail with ENOENT.
    installDir = path.join(tempDir, ".claude", "skills");
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("installs all shipped skills into the destination directory", async () => {
    const { exitCode, stdout } = await runBuiltCliCommand([
      "skills",
      "install",
      "--dir",
      installDir,
    ]);

    expect(exitCode).toBe(0);

    const names = shippedSkillNames();
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const destFile = path.join(installDir, name, "SKILL.md");
      expect(fs.existsSync(destFile), `Expected ${destFile} to exist`).toBe(true);

      const srcContent = fs.readFileSync(path.join(SKILLS_SRC, name, "SKILL.md"), "utf8");
      const destContent = fs.readFileSync(destFile, "utf8");
      expect(destContent).toBe(srcContent);

      expect(stdout).toContain(`installed ${name}`);
    }
  }, 30_000);

  it("reports up-to-date on second run with no changes", async () => {
    // First run installs; second run should report all up-to-date
    await runBuiltCliCommand(["skills", "install", "--dir", installDir]);
    const { exitCode, stdout } = await runBuiltCliCommand([
      "skills",
      "install",
      "--dir",
      installDir,
    ]);

    expect(exitCode).toBe(0);

    const names = shippedSkillNames();
    for (const name of names) {
      expect(stdout).toContain(`up-to-date ${name}`);
    }
    expect(stdout).not.toContain("installed");
  }, 30_000);
});
