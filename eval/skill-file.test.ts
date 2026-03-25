import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const MCP_SKILL_FILE = path.join(PROJECT_ROOT, ".claude/skills/light-bridge-refactoring/SKILL.md");
const CLI_SKILL_FILE = path.join(PROJECT_ROOT, ".claude/skills/light-bridge-cli/SKILL.md");
const PACKAGE_JSON = path.join(PROJECT_ROOT, "package.json");

describe("shipped MCP skill file", () => {
  describe("packaging", () => {
    it("exists to be dogfooded by claude", () => {
      expect(fs.existsSync(MCP_SKILL_FILE)).toBe(true);
    });

    it("is included in package.json files for npm distribution", () => {
      const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf-8"));
      expect(pkg.files).toContain(".claude/skills/light-bridge-refactoring");
    });
  });

  describe("format", () => {
    it("has valid YAML frontmatter with name and description", () => {
      const content = fs.readFileSync(MCP_SKILL_FILE, "utf-8");
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatterMatch).not.toBeNull();
      const frontmatter = frontmatterMatch?.[1];
      expect(frontmatter).toMatch(/^name:\s+\S+/m);
      expect(frontmatter).toMatch(/^description:\s+\S+/m);
    });

    it("stays under 200 lines to respect agent context budgets", () => {
      const content = fs.readFileSync(MCP_SKILL_FILE, "utf-8");
      const lineCount = content.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(200);
    });
  });

  describe("decision guidance for write operations", () => {
    const WRITE_OPERATIONS = ["rename", "moveFile", "moveSymbol", "deleteFile", "extractFunction"];

    it.each(WRITE_OPERATIONS)("covers %s", (op) => {
      const content = fs.readFileSync(MCP_SKILL_FILE, "utf-8");
      expect(content).toContain(op);
    });

    it("describes when to use light-bridge vs manual editing", () => {
      const content = fs.readFileSync(MCP_SKILL_FILE, "utf-8");
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
      const content = fs.readFileSync(MCP_SKILL_FILE, "utf-8");
      const hasNoVerifyGuidance =
        content.includes("Do not read") ||
        content.includes("don't read") ||
        content.includes("no need to read");
      expect(hasNoVerifyGuidance).toBe(true);
    });

    it("covers typeErrors as an action item", () => {
      const content = fs.readFileSync(MCP_SKILL_FILE, "utf-8");
      expect(content).toContain("typeErrors");
    });

    it("covers filesSkipped for user-facing communication", () => {
      const content = fs.readFileSync(MCP_SKILL_FILE, "utf-8");
      expect(content).toContain("filesSkipped");
    });

    it("covers DAEMON_STARTING retry behaviour", () => {
      const content = fs.readFileSync(MCP_SKILL_FILE, "utf-8");
      expect(content).toContain("DAEMON_STARTING");
    });
  });

  describe("host-agnostic", () => {
    it("does not use agent-host-specific tool name prefixes", () => {
      const content = fs.readFileSync(MCP_SKILL_FILE, "utf-8");
      expect(content).not.toContain("mcp__light-bridge__");
      expect(content).not.toContain("mcp__");
    });
  });
});

describe("shipped CLI skill file", () => {
  describe("packaging", () => {
    it("exists alongside the MCP skill", () => {
      expect(fs.existsSync(CLI_SKILL_FILE)).toBe(true);
    });

    it("is included in package.json files for npm distribution", () => {
      const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf-8"));
      expect(pkg.files).toContain(".claude/skills/light-bridge-cli");
    });
  });

  describe("format", () => {
    it("has valid YAML frontmatter with name and description", () => {
      const content = fs.readFileSync(CLI_SKILL_FILE, "utf-8");
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatterMatch).not.toBeNull();
      const frontmatter = frontmatterMatch?.[1];
      expect(frontmatter).toMatch(/^name:\s+\S+/m);
      expect(frontmatter).toMatch(/^description:\s+\S+/m);
    });

    it("stays under 200 lines to respect agent context budgets", () => {
      const content = fs.readFileSync(CLI_SKILL_FILE, "utf-8");
      const lineCount = content.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(200);
    });
  });

  describe("covers all 11 CLI subcommands", () => {
    const SUBCOMMANDS = [
      "rename",
      "move-file",
      "move-directory",
      "move-symbol",
      "extract-function",
      "find-references",
      "get-definition",
      "get-type-errors",
      "search-text",
      "delete-file",
      "replace-text",
    ];

    it.each(SUBCOMMANDS)("covers %s", (cmd) => {
      const content = fs.readFileSync(CLI_SKILL_FILE, "utf-8");
      expect(content).toContain(cmd);
    });
  });

  describe("shows CLI invocation syntax", () => {
    it("shows the light-bridge command with JSON argument pattern", () => {
      const content = fs.readFileSync(CLI_SKILL_FILE, "utf-8");
      expect(content).toContain("light-bridge");
      expect(content).toMatch(/light-bridge \w/);
    });

    it("shows stdin piping as an alternative", () => {
      const content = fs.readFileSync(CLI_SKILL_FILE, "utf-8");
      expect(content).toContain("stdin");
    });

    it("explains relative path resolution", () => {
      const content = fs.readFileSync(CLI_SKILL_FILE, "utf-8");
      expect(content).toContain("--workspace");
      expect(content).toMatch(/relative|resolve/i);
    });
  });

  describe("response handling guidance", () => {
    it("covers typeErrors as action items", () => {
      const content = fs.readFileSync(CLI_SKILL_FILE, "utf-8");
      expect(content).toContain("typeErrors");
      expect(content).toMatch(/action item/i);
    });

    it("covers filesSkipped", () => {
      const content = fs.readFileSync(CLI_SKILL_FILE, "utf-8");
      expect(content).toContain("filesSkipped");
    });

    it("covers DAEMON_STARTING retry behaviour", () => {
      const content = fs.readFileSync(CLI_SKILL_FILE, "utf-8");
      expect(content).toContain("DAEMON_STARTING");
    });

    it("covers exit codes", () => {
      const content = fs.readFileSync(CLI_SKILL_FILE, "utf-8");
      expect(content).toMatch(/exit code/i);
    });
  });

  describe("does not reference MCP", () => {
    it("uses CLI syntax, not MCP tool calls", () => {
      const content = fs.readFileSync(CLI_SKILL_FILE, "utf-8");
      expect(content).not.toContain("mcp__");
      expect(content).not.toContain("MCP");
    });
  });
});
