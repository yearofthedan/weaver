import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../../ports/filesystem.js";
import { deriveSkillNamesFromPackageJson, installSkills } from "./install-skills.js";

describe("installSkills", () => {
  const SOURCE = "/pkg/.claude/skills";
  const DEST = "/project/.claude/skills";
  const SKILL_A = "weaver-refactor";
  const SKILL_B = "weaver-code-inspection";
  const CONTENT_A = "# Refactor skill";
  const CONTENT_B = "# Code inspection skill";

  function seedSource(fs: InMemoryFileSystem): void {
    fs.writeFile(`${SOURCE}/${SKILL_A}/SKILL.md`, CONTENT_A);
    fs.writeFile(`${SOURCE}/${SKILL_B}/SKILL.md`, CONTENT_B);
  }

  describe("clean destination", () => {
    it("writes all skills and reports installed for each", () => {
      const fs = new InMemoryFileSystem();
      seedSource(fs);

      const report = installSkills([SKILL_A, SKILL_B], SOURCE, DEST, fs, { force: false });

      expect(report).toEqual([
        { name: SKILL_A, outcome: "installed" },
        { name: SKILL_B, outcome: "installed" },
      ]);
    });

    it("writes the source content to the destination path", () => {
      const fs = new InMemoryFileSystem();
      seedSource(fs);

      installSkills([SKILL_A], SOURCE, DEST, fs, { force: false });

      expect(fs.readFile(`${DEST}/${SKILL_A}/SKILL.md`)).toBe(CONTENT_A);
    });

    it("creates the skill subdirectory before writing", () => {
      const fs = new InMemoryFileSystem();
      seedSource(fs);

      installSkills([SKILL_A], SOURCE, DEST, fs, { force: false });

      expect(fs.exists(`${DEST}/${SKILL_A}`)).toBe(true);
    });

    it("returns an empty report when no skill names are provided", () => {
      const fs = new InMemoryFileSystem();
      const report = installSkills([], SOURCE, DEST, fs, { force: false });
      expect(report).toEqual([]);
    });
  });

  describe("destination already up-to-date", () => {
    it("reports up-to-date when content is byte-identical", () => {
      const fs = new InMemoryFileSystem();
      seedSource(fs);
      fs.mkdir(`${DEST}/${SKILL_A}`, { recursive: true });
      fs.writeFile(`${DEST}/${SKILL_A}/SKILL.md`, CONTENT_A);

      const report = installSkills([SKILL_A], SOURCE, DEST, fs, { force: false });

      expect(report).toEqual([{ name: SKILL_A, outcome: "up-to-date" }]);
    });

    it("does not rewrite the file when content is identical", () => {
      const fs = new InMemoryFileSystem();
      seedSource(fs);
      const originalContent = CONTENT_A;
      fs.mkdir(`${DEST}/${SKILL_A}`, { recursive: true });
      fs.writeFile(`${DEST}/${SKILL_A}/SKILL.md`, originalContent);

      installSkills([SKILL_A], SOURCE, DEST, fs, { force: false });

      expect(fs.readFile(`${DEST}/${SKILL_A}/SKILL.md`)).toBe(originalContent);
    });

    it("reports all skills up-to-date when run twice with no changes", () => {
      const fs = new InMemoryFileSystem();
      seedSource(fs);

      installSkills([SKILL_A, SKILL_B], SOURCE, DEST, fs, { force: false });
      const secondReport = installSkills([SKILL_A, SKILL_B], SOURCE, DEST, fs, { force: false });

      expect(secondReport).toEqual([
        { name: SKILL_A, outcome: "up-to-date" },
        { name: SKILL_B, outcome: "up-to-date" },
      ]);
    });
  });

  describe("diverged content without --force", () => {
    it("reports skipped-diverged when content differs", () => {
      const fs = new InMemoryFileSystem();
      seedSource(fs);
      fs.mkdir(`${DEST}/${SKILL_A}`, { recursive: true });
      fs.writeFile(`${DEST}/${SKILL_A}/SKILL.md`, "# User-edited version");

      const report = installSkills([SKILL_A], SOURCE, DEST, fs, { force: false });

      expect(report).toEqual([{ name: SKILL_A, outcome: "skipped-diverged" }]);
    });

    it("leaves the destination file unchanged when content diverged and force is off", () => {
      const fs = new InMemoryFileSystem();
      seedSource(fs);
      const userEdits = "# User-edited version";
      fs.mkdir(`${DEST}/${SKILL_A}`, { recursive: true });
      fs.writeFile(`${DEST}/${SKILL_A}/SKILL.md`, userEdits);

      installSkills([SKILL_A], SOURCE, DEST, fs, { force: false });

      expect(fs.readFile(`${DEST}/${SKILL_A}/SKILL.md`)).toBe(userEdits);
    });

    it("does not overwrite the file even when other skills are absent", () => {
      const fs = new InMemoryFileSystem();
      seedSource(fs);
      const userEdits = "# My custom version";
      fs.mkdir(`${DEST}/${SKILL_A}`, { recursive: true });
      fs.writeFile(`${DEST}/${SKILL_A}/SKILL.md`, userEdits);

      const report = installSkills([SKILL_A, SKILL_B], SOURCE, DEST, fs, { force: false });

      expect(report[0].outcome).toBe("skipped-diverged");
      expect(report[1].outcome).toBe("installed");
      expect(fs.readFile(`${DEST}/${SKILL_A}/SKILL.md`)).toBe(userEdits);
    });
  });

  describe("diverged content with --force", () => {
    it("overwrites and reports overwritten when content diverged and force is on", () => {
      const fs = new InMemoryFileSystem();
      seedSource(fs);
      fs.mkdir(`${DEST}/${SKILL_A}`, { recursive: true });
      fs.writeFile(`${DEST}/${SKILL_A}/SKILL.md`, "# User-edited version");

      const report = installSkills([SKILL_A], SOURCE, DEST, fs, { force: true });

      expect(report).toEqual([{ name: SKILL_A, outcome: "overwritten" }]);
    });

    it("writes the shipped content to the destination when force is on", () => {
      const fs = new InMemoryFileSystem();
      seedSource(fs);
      fs.mkdir(`${DEST}/${SKILL_A}`, { recursive: true });
      fs.writeFile(`${DEST}/${SKILL_A}/SKILL.md`, "# User-edited version");

      installSkills([SKILL_A], SOURCE, DEST, fs, { force: true });

      expect(fs.readFile(`${DEST}/${SKILL_A}/SKILL.md`)).toBe(CONTENT_A);
    });
  });
});

describe("deriveSkillNamesFromPackageJson", () => {
  it("returns basenames of entries under .claude/skills/", () => {
    const pkg = JSON.stringify({
      files: [
        "dist",
        ".claude/skills/weaver-search-and-replace",
        ".claude/skills/weaver-refactor",
        ".claude/skills/weaver-code-inspection",
      ],
    });

    const names = deriveSkillNamesFromPackageJson(pkg);

    expect(names).toEqual([
      "weaver-search-and-replace",
      "weaver-refactor",
      "weaver-code-inspection",
    ]);
  });

  it("excludes entries not under .claude/skills/", () => {
    const pkg = JSON.stringify({
      files: ["dist", "README.md", ".claude/skills/weaver-refactor"],
    });

    const names = deriveSkillNamesFromPackageJson(pkg);

    expect(names).toEqual(["weaver-refactor"]);
    expect(names).not.toContain("dist");
    expect(names).not.toContain("README.md");
  });

  it("returns an empty array when files array has no skill entries", () => {
    const pkg = JSON.stringify({ files: ["dist"] });
    expect(deriveSkillNamesFromPackageJson(pkg)).toEqual([]);
  });

  it("returns an empty array when files array is absent", () => {
    const pkg = JSON.stringify({ name: "my-pkg" });
    expect(deriveSkillNamesFromPackageJson(pkg)).toEqual([]);
  });

  it("maps only the basename — not the full path segment", () => {
    const pkg = JSON.stringify({
      files: [".claude/skills/weaver-search-and-replace"],
    });
    const [name] = deriveSkillNamesFromPackageJson(pkg);
    expect(name).toBe("weaver-search-and-replace");
    expect(name).not.toContain("/");
  });
});
