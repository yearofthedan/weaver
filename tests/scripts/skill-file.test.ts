import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const SKILL_FILE = path.join(PROJECT_ROOT, ".claude/skills/light-bridge-refactoring/SKILL.md");
const PACKAGE_JSON = path.join(PROJECT_ROOT, "package.json");

describe("shipped skill file", () => {
  describe("packaging", () => {
    it(`exists at ${SKILL_FILE} to be dogfooded by claude`, () => {
      expect(fs.existsSync(SKILL_FILE)).toBe(true);
    });

    it("is included in package.json files for npm distribution", () => {
      const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf-8"));
      expect(pkg.files).toContain(".claude/skills/light-bridge-refactoring");
    });
  });

  describe("format", () => {
    it("has valid YAML frontmatter with name and description", () => {
      const content = fs.readFileSync(SKILL_FILE, "utf-8");
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatterMatch).not.toBeNull();
      const frontmatter = frontmatterMatch?.[1];
      expect(frontmatter).toMatch(/^name:\s+\S+/m);
      expect(frontmatter).toMatch(/^description:\s+\S+/m);
    });

    it("stays under 200 lines to respect agent context budgets", () => {
      const content = fs.readFileSync(SKILL_FILE, "utf-8");
      const lineCount = content.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(200);
    });
  });

  describe("decision guidance for write operations", () => {
    const WRITE_OPERATIONS = ["rename", "moveFile", "moveSymbol", "deleteFile", "extractFunction"];

    it.each(WRITE_OPERATIONS)("covers %s", (op) => {
      const content = fs.readFileSync(SKILL_FILE, "utf-8");
      expect(content).toContain(op);
    });

    it("describes when to use light-bridge vs manual editing", () => {
      const content = fs.readFileSync(SKILL_FILE, "utf-8");
      // Must contain heuristics about choosing compiler-aware tools over direct file editing
      const hasDecisionGuidance =
        content.includes("instead of") ||
        content.includes("use light-bridge") ||
        content.includes("not ") ||
        content.includes("rather than");
      expect(hasDecisionGuidance).toBe(true);
    });
  });

  describe("response handling guidance", () => {
    it("tells agents not to read files to verify results", () => {
      const content = fs.readFileSync(SKILL_FILE, "utf-8");
      const hasNoVerifyGuidance =
        content.includes("Do not read") ||
        content.includes("don't read") ||
        content.includes("no need to read");
      expect(hasNoVerifyGuidance).toBe(true);
    });

    it("covers typeErrors as an action item", () => {
      const content = fs.readFileSync(SKILL_FILE, "utf-8");
      expect(content).toContain("typeErrors");
    });

    it("covers filesSkipped for user-facing communication", () => {
      const content = fs.readFileSync(SKILL_FILE, "utf-8");
      expect(content).toContain("filesSkipped");
    });

    it("covers DAEMON_STARTING retry behaviour", () => {
      const content = fs.readFileSync(SKILL_FILE, "utf-8");
      expect(content).toContain("DAEMON_STARTING");
    });
  });

  describe("host-agnostic", () => {
    it("does not use agent-host-specific tool name prefixes", () => {
      const content = fs.readFileSync(SKILL_FILE, "utf-8");
      expect(content).not.toContain("mcp__light-bridge__");
      expect(content).not.toContain("mcp__");
    });
  });
});
