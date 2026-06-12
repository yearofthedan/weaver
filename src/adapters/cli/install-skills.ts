import * as nodePath from "node:path";
import type { FileSystem } from "../../ports/filesystem.js";

type SkillInstallOutcome = "installed" | "up-to-date" | "skipped-diverged" | "overwritten";

interface SkillInstallResult {
  name: string;
  outcome: SkillInstallOutcome;
}

type InstallReport = SkillInstallResult[];

interface InstallSkillsOptions {
  force: boolean;
}

/**
 * Copy shipped skills from sourceDir to destDir, reporting the outcome per skill.
 * For each skill: src = <sourceDir>/<name>/SKILL.md, dest = <destDir>/<name>/SKILL.md.
 * - dest absent → write, outcome "installed"
 * - dest present and byte-identical → no write, "up-to-date"
 * - dest present and differs, force off → no write, "skipped-diverged"
 * - dest present and differs, force on → write, "overwritten"
 */
function installSkills(
  skillNames: readonly string[],
  sourceDir: string,
  destDir: string,
  fs: FileSystem,
  options: InstallSkillsOptions,
): InstallReport {
  const report: InstallReport = [];

  for (const name of skillNames) {
    const srcPath = nodePath.join(sourceDir, name, "SKILL.md");
    const destPath = nodePath.join(destDir, name, "SKILL.md");
    const srcContent = fs.readFile(srcPath);

    if (!fs.exists(destPath)) {
      fs.mkdir(nodePath.join(destDir, name), { recursive: true });
      fs.writeFile(destPath, srcContent);
      report.push({ name, outcome: "installed" });
      continue;
    }

    const destContent = fs.readFile(destPath);

    if (destContent === srcContent) {
      report.push({ name, outcome: "up-to-date" });
      continue;
    }

    if (options.force) {
      fs.writeFile(destPath, srcContent);
      report.push({ name, outcome: "overwritten" });
    } else {
      report.push({ name, outcome: "skipped-diverged" });
    }
  }

  return report;
}

interface PackageJson {
  files?: string[];
}

/**
 * Derive the list of skill directory names from the package.json "files" array.
 * Keeps entries under ".claude/skills/" and returns the basename of each.
 * This is the single source of truth: the "files" array is exactly the manifest
 * of what ships in the npm tarball.
 */
function deriveSkillNamesFromPackageJson(packageJsonContent: string): string[] {
  const pkg = JSON.parse(packageJsonContent) as PackageJson;
  const files = pkg.files ?? [];
  return files
    .filter((entry) => entry.startsWith(".claude/skills/"))
    .map((entry) => nodePath.basename(entry));
}

/** Render one human-readable stdout line per install outcome. */
function formatInstallReport(report: InstallReport, displayDir: string): string[] {
  const lines: string[] = [];
  for (const { name, outcome } of report) {
    switch (outcome) {
      case "installed":
        lines.push(`installed ${name} → ${nodePath.join(displayDir, name, "SKILL.md")}\n`);
        break;
      case "up-to-date":
        lines.push(`up-to-date ${name}\n`);
        break;
      case "skipped-diverged":
        lines.push(`skipped ${name} (diverged; use --force to overwrite)\n`);
        break;
      case "overwritten":
        lines.push(`overwritten ${name}\n`);
        break;
    }
  }
  return lines;
}

export interface InstallSkillsContext {
  fs: FileSystem;
  /** Root of the installed weaver package — holds package.json and .claude/skills. */
  pkgRoot: string;
  write: (line: string) => void;
}

/**
 * Orchestrate `weaver skills install`: derive the shipped skill names from the
 * package manifest, copy them into the destination, and print the per-skill
 * outcome. The "installed" line shows the raw `opts.dir` as the user typed it;
 * the copy itself resolves it to an absolute path.
 */
export function runInstallSkills(
  opts: { dir: string; force?: boolean },
  context: InstallSkillsContext,
): void {
  const { fs, pkgRoot, write } = context;
  const packageJsonPath = nodePath.join(pkgRoot, "package.json");
  const sourceDir = nodePath.join(pkgRoot, ".claude/skills");
  const destDir = nodePath.resolve(opts.dir);

  const skillNames = deriveSkillNamesFromPackageJson(fs.readFile(packageJsonPath));
  const report = installSkills(skillNames, sourceDir, destDir, fs, {
    force: opts.force ?? false,
  });

  for (const line of formatInstallReport(report, opts.dir)) {
    write(line);
  }
}
