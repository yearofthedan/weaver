import * as nodePath from "node:path";
import type { FileSystem } from "../../ports/filesystem.js";

export type SkillInstallOutcome = "installed" | "up-to-date" | "skipped-diverged" | "overwritten";

export interface SkillInstallResult {
  name: string;
  outcome: SkillInstallOutcome;
}

export type InstallReport = SkillInstallResult[];

export interface InstallSkillsOptions {
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
export function installSkills(
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
export function deriveSkillNamesFromPackageJson(packageJsonContent: string): string[] {
  const pkg = JSON.parse(packageJsonContent) as PackageJson;
  const files = pkg.files ?? [];
  return files
    .filter((entry) => entry.startsWith(".claude/skills/"))
    .map((entry) => nodePath.basename(entry));
}
