import * as nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../../ports/filesystem.js";
import { type InstallSkillsContext, runInstallSkills } from "./install-skills.js";

const PKG_ROOT = "/pkg";
const SOURCE = `${PKG_ROOT}/.claude/skills`;
const DEST = "/project/.claude/skills";
const SKILL_A = "weaver-refactor";
const SKILL_B = "weaver-code-inspection";
const CONTENT_A = "# Refactor skill";
const CONTENT_B = "# Code inspection skill";

interface Harness {
  fs: InMemoryFileSystem;
  lines: string[];
  context: InstallSkillsContext;
}

/**
 * Seed an in-memory package root: a package.json whose "files" manifest lists
 * the shipped skills plus the source SKILL.md for each. Returns the install
 * context and a buffer that captures the printed output lines.
 */
function setup(
  files: string[] = [`.claude/skills/${SKILL_A}`, `.claude/skills/${SKILL_B}`],
): Harness {
  const fs = new InMemoryFileSystem();
  fs.writeFile(`${PKG_ROOT}/package.json`, JSON.stringify({ files }));
  fs.writeFile(`${SOURCE}/${SKILL_A}/SKILL.md`, CONTENT_A);
  fs.writeFile(`${SOURCE}/${SKILL_B}/SKILL.md`, CONTENT_B);
  const lines: string[] = [];
  const context: InstallSkillsContext = {
    fs,
    pkgRoot: PKG_ROOT,
    write: (line) => lines.push(line),
  };
  return { fs, lines, context };
}

function seedDest(fs: InMemoryFileSystem, skill: string, content: string): void {
  fs.mkdir(`${DEST}/${skill}`, { recursive: true });
  fs.writeFile(`${DEST}/${skill}/SKILL.md`, content);
}

describe("runInstallSkills", () => {
  describe("clean destination", () => {
    it("writes the shipped content for every skill in the manifest", () => {
      const { fs, context } = setup();

      runInstallSkills({ dir: DEST }, context);

      expect(fs.readFile(`${DEST}/${SKILL_A}/SKILL.md`)).toBe(CONTENT_A);
      expect(fs.readFile(`${DEST}/${SKILL_B}/SKILL.md`)).toBe(CONTENT_B);
    });

    it("creates missing destination directories recursively", () => {
      const { fs, context } = setup();

      // DEST and its parent do not exist yet.
      expect(fs.exists(DEST)).toBe(false);
      runInstallSkills({ dir: DEST }, context);

      expect(fs.exists(`${DEST}/${SKILL_A}`)).toBe(true);
    });

    it("prints an installed line naming the destination path for each skill", () => {
      const { lines, context } = setup();

      runInstallSkills({ dir: DEST }, context);

      expect(lines).toEqual([
        `installed ${SKILL_A} → ${nodePath.join(DEST, SKILL_A, "SKILL.md")}\n`,
        `installed ${SKILL_B} → ${nodePath.join(DEST, SKILL_B, "SKILL.md")}\n`,
      ]);
    });
  });

  describe("destination already up-to-date", () => {
    it("does not rewrite a byte-identical file and reports up-to-date", () => {
      const { fs, lines, context } = setup();
      seedDest(fs, SKILL_A, CONTENT_A);
      seedDest(fs, SKILL_B, CONTENT_B);

      runInstallSkills({ dir: DEST }, context);

      expect(fs.readFile(`${DEST}/${SKILL_A}/SKILL.md`)).toBe(CONTENT_A);
      expect(lines).toEqual([`up-to-date ${SKILL_A}\n`, `up-to-date ${SKILL_B}\n`]);
    });

    it("reports every skill up-to-date when run twice with no changes", () => {
      const first = setup();
      runInstallSkills({ dir: DEST }, first.context);

      const second: InstallSkillsContext = { ...first.context, write: () => {} };
      const secondLines: string[] = [];
      runInstallSkills({ dir: DEST }, { ...second, write: (l) => secondLines.push(l) });

      expect(secondLines).toEqual([`up-to-date ${SKILL_A}\n`, `up-to-date ${SKILL_B}\n`]);
    });
  });

  describe("diverged content without --force", () => {
    it("leaves the edited file untouched and reports skipped", () => {
      const { fs, lines, context } = setup();
      const userEdits = "# User-edited version";
      seedDest(fs, SKILL_A, userEdits);

      runInstallSkills({ dir: DEST }, context);

      expect(fs.readFile(`${DEST}/${SKILL_A}/SKILL.md`)).toBe(userEdits);
      expect(lines[0]).toBe(`skipped ${SKILL_A} (diverged; use --force to overwrite)\n`);
    });

    it("still installs other absent skills when one has diverged", () => {
      const { fs, lines, context } = setup();
      seedDest(fs, SKILL_A, "# My custom version");

      runInstallSkills({ dir: DEST }, context);

      expect(lines[0]).toBe(`skipped ${SKILL_A} (diverged; use --force to overwrite)\n`);
      expect(lines[1]).toBe(`installed ${SKILL_B} → ${nodePath.join(DEST, SKILL_B, "SKILL.md")}\n`);
      expect(fs.readFile(`${DEST}/${SKILL_B}/SKILL.md`)).toBe(CONTENT_B);
    });
  });

  describe("diverged content with --force", () => {
    it("overwrites the edited file with shipped content and reports overwritten", () => {
      const { fs, lines, context } = setup();
      seedDest(fs, SKILL_A, "# User-edited version");
      seedDest(fs, SKILL_B, CONTENT_B);

      runInstallSkills({ dir: DEST, force: true }, context);

      expect(fs.readFile(`${DEST}/${SKILL_A}/SKILL.md`)).toBe(CONTENT_A);
      expect(lines[0]).toBe(`overwritten ${SKILL_A}\n`);
    });
  });

  describe("manifest derivation", () => {
    it("installs only entries under .claude/skills/, ignoring other files", () => {
      const { fs, lines, context } = setup(["dist", "README.md", `.claude/skills/${SKILL_A}`]);

      runInstallSkills({ dir: DEST }, context);

      expect(fs.exists(`${DEST}/${SKILL_A}/SKILL.md`)).toBe(true);
      expect(fs.exists(`${DEST}/${SKILL_B}/SKILL.md`)).toBe(false);
      expect(lines).toEqual([
        `installed ${SKILL_A} → ${nodePath.join(DEST, SKILL_A, "SKILL.md")}\n`,
      ]);
    });

    it("installs nothing and prints nothing when the manifest lists no skills", () => {
      const { fs, lines, context } = setup(["dist"]);

      runInstallSkills({ dir: DEST }, context);

      expect(lines).toEqual([]);
      expect(fs.exists(DEST)).toBe(false);
    });
  });
});
