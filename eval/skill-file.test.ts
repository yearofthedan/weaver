import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGE_JSON = path.join(PROJECT_ROOT, "package.json");

const SHIPPED_SKILLS = [
  {
    name: "search-and-replace",
    path: ".claude/skills/search-and-replace/SKILL.md",
    packageEntry: ".claude/skills/search-and-replace",
    operations: ["search-text", "replace-text"],
    errorCodes: ["DAEMON_STARTING"],
  },
  {
    name: "move-and-rename",
    path: ".claude/skills/move-and-rename/SKILL.md",
    packageEntry: ".claude/skills/move-and-rename",
    operations: [
      "rename",
      "move-file",
      "move-directory",
      "move-symbol",
      "delete-file",
      "extract-function",
    ],
    errorCodes: ["DAEMON_STARTING", "SYMBOL_NOT_FOUND", "FILE_NOT_FOUND"],
  },
  {
    name: "code-inspection",
    path: ".claude/skills/code-inspection/SKILL.md",
    packageEntry: ".claude/skills/code-inspection",
    operations: ["find-references", "get-definition", "get-type-errors"],
    errorCodes: ["DAEMON_STARTING", "SYMBOL_NOT_FOUND", "FILE_NOT_FOUND"],
  },
];

describe.each(SHIPPED_SKILLS)("shipped skill: $name", (skill) => {
  const fullPath = path.join(PROJECT_ROOT, skill.path);

  describe("packaging", () => {
    it("exists on disk", () => {
      expect(fs.existsSync(fullPath)).toBe(true);
    });

    it("is included in package.json files for npm distribution", () => {
      const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf-8"));
      expect(pkg.files).toContain(skill.packageEntry);
    });
  });

  describe("format", () => {
    it("has valid YAML frontmatter with name and description", () => {
      const content = fs.readFileSync(fullPath, "utf-8");
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatterMatch).not.toBeNull();
      const frontmatter = frontmatterMatch?.[1];
      expect(frontmatter).toMatch(/^name:\s+\S+/m);
      expect(frontmatter).toMatch(/^description:\s+\S+/m);
    });

    it("stays under 200 lines to respect agent context budgets", () => {
      const content = fs.readFileSync(fullPath, "utf-8");
      const lineCount = content.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(200);
    });
  });

  describe("operation coverage", () => {
    it.each(skill.operations)("covers %s", (op) => {
      const content = fs.readFileSync(fullPath, "utf-8");
      expect(content).toContain(op);
    });
  });

  describe("error handling", () => {
    it.each(skill.errorCodes)("covers %s error code", (code) => {
      const content = fs.readFileSync(fullPath, "utf-8");
      expect(content).toContain(code);
    });
  });

  describe("host-agnostic", () => {
    it("does not use agent-host-specific tool name prefixes", () => {
      const content = fs.readFileSync(fullPath, "utf-8");
      expect(content).not.toContain("mcp__weaver__");
      expect(content).not.toContain("mcp__");
    });
  });
});

describe("move-and-rename skill", () => {
  const fullPath = path.join(PROJECT_ROOT, ".claude/skills/move-and-rename/SKILL.md");

  it("describes response fields for write operations", () => {
    const content = fs.readFileSync(fullPath, "utf-8");
    expect(content).toContain("filesModified");
    expect(content).toContain("filesSkipped");
    expect(content).toContain("typeErrors");
  });
});

describe("search-and-replace skill", () => {
  const fullPath = path.join(PROJECT_ROOT, ".claude/skills/search-and-replace/SKILL.md");

  it("describes response fields", () => {
    const content = fs.readFileSync(fullPath, "utf-8");
    expect(content).toContain("filesModified");
    expect(content).toContain("typeErrors");
  });
});

describe("skills use CLI invocation syntax", () => {
  it.each(SHIPPED_SKILLS)("$name shows weaver CLI commands", (skill) => {
    const fullPath = path.join(PROJECT_ROOT, skill.path);
    const content = fs.readFileSync(fullPath, "utf-8");
    expect(content).toContain("weaver");
    expect(content).toMatch(/weaver \w/);
  });
});
