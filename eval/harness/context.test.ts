import * as fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ToolCall } from "./call-model.js";
import {
  buildAvailableSkillsPrompt,
  classifySkillReach,
  readSkillFile,
  SKILL_NAMES,
  skillContext,
  skillFrontmatters,
  skillLocation,
} from "./context.js";

const tc = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
  name,
  arguments: args,
});

// Wraps the real readFileSync so most calls behave normally; individual
// tests override a single call with mockReturnValueOnce/mockImplementationOnce
// to inject synthetic frontmatter content or a synthetic read error, then
// fall back to the real implementation automatically once consumed.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

describe("readSkillFile", () => {
  it("throws the friendly not-found message for a missing skill", () => {
    expect(() => readSkillFile("nonexistent-skill")).toThrow("Skill file not found");
  });
});

describe("parseSkillFrontmatter (via skillFrontmatters)", () => {
  it("does not match a frontmatter block that starts partway through the file", () => {
    vi.mocked(fs.readFileSync).mockReturnValueOnce(
      "garbage before frontmatter\n---\nname: x\ndescription: y\n---\nbody",
    );
    expect(() => skillFrontmatters()).toThrow("no valid frontmatter");
  });

  it("throws the friendly missing-frontmatter message, not a raw property-access error, when no frontmatter block exists at all", () => {
    vi.mocked(fs.readFileSync).mockReturnValueOnce("no frontmatter markers in this file at all");
    expect(() => skillFrontmatters()).toThrow("no valid frontmatter");
  });

  it("requires name/description keys to start their line, not merely contain the key as a substring", () => {
    vi.mocked(fs.readFileSync).mockReturnValueOnce(
      "---\nxname: wrong-name\nname: real-name\nxdescription: wrong-desc\ndescription: real-desc\n---\n",
    );
    const [frontmatter] = skillFrontmatters();
    expect(frontmatter.name).toBe("real-name");
    expect(frontmatter.description).toBe("real-desc");
  });

  it("throws the friendly missing-key message, not a raw property-access error, when description is absent", () => {
    vi.mocked(fs.readFileSync).mockReturnValueOnce("---\nname: only-name\n---\n");
    expect(() => skillFrontmatters()).toThrow("missing name or description");
  });

  it("trims trailing whitespace from both the name and description values", () => {
    vi.mocked(fs.readFileSync).mockReturnValueOnce(
      "---\nname: padded-name   \ndescription: padded-desc   \n---\n",
    );
    const [frontmatter] = skillFrontmatters();
    expect(frontmatter.name).toBe("padded-name");
    expect(frontmatter.description).toBe("padded-desc");
  });
});

describe("skillFrontmatters", () => {
  it("returns name and description for all three shipped skills", () => {
    const frontmatters = skillFrontmatters();
    expect(frontmatters.map((f) => f.name)).toEqual([
      "weaver-search-and-replace",
      "weaver-refactor",
      "weaver-code-inspection",
    ]);
  });

  it("extracts a non-empty, single-line description for each skill", () => {
    for (const { name, description } of skillFrontmatters()) {
      expect(description.length, `${name} description is empty`).toBeGreaterThan(0);
      expect(description, `${name} description should be a single line`).not.toContain("\n");
    }
  });
});

describe("skillLocation", () => {
  it("returns the relative SKILL.md path for a skill name", () => {
    expect(skillLocation("weaver-refactor")).toBe(".claude/skills/weaver-refactor/SKILL.md");
  });
});

describe("buildAvailableSkillsPrompt", () => {
  it("wraps the skills list in an <available_skills> block", () => {
    const prompt = buildAvailableSkillsPrompt();
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("</available_skills>");
  });

  it("includes each skill's <name> tag", () => {
    const prompt = buildAvailableSkillsPrompt();
    for (const name of SKILL_NAMES) {
      expect(prompt).toContain(`<name>${name}</name>`);
    }
  });

  it("includes each skill's verbatim description byte-identical to skillFrontmatters", () => {
    const frontmatters = skillFrontmatters();
    const prompt = buildAvailableSkillsPrompt();
    for (const { description } of frontmatters) {
      expect(prompt).toContain(description);
    }
  });

  it("includes each skill's <location> from skillLocation", () => {
    const prompt = buildAvailableSkillsPrompt();
    for (const name of SKILL_NAMES) {
      expect(prompt).toContain(`<location>${skillLocation(name)}</location>`);
    }
  });

  it("appends usage guidance after the skills block", () => {
    const prompt = buildAvailableSkillsPrompt();
    const afterBlock = prompt.slice(
      prompt.indexOf("</available_skills>") + "</available_skills>".length,
    );
    expect(afterBlock.trim().length).toBeGreaterThan(0);
  });
});

describe("classifySkillReach", () => {
  it("recognizes a Skill() load of a valid skill name", () => {
    expect(classifySkillReach(tc("Skill", { skill: "weaver-refactor" }))).toEqual({
      skill: "weaver-refactor",
      via: "load",
    });
  });

  it("returns undefined for a Skill() call naming an unknown skill", () => {
    expect(classifySkillReach(tc("Skill", { skill: "nonsense" }))).toBeUndefined();
  });

  it("recognizes a Read of a skill's SKILL.md by absolute path suffix", () => {
    expect(
      classifySkillReach(tc("Read", { file: "/abs/.claude/skills/weaver-refactor/SKILL.md" })),
    ).toEqual({ skill: "weaver-refactor", via: "load" });
  });

  it("recognizes a Read of a skill's SKILL.md via a ./-prefixed path", () => {
    expect(
      classifySkillReach(tc("Read", { file: "./.claude/skills/weaver-refactor/SKILL.md" })),
    ).toEqual({ skill: "weaver-refactor", via: "load" });
  });

  it("returns undefined for a Read of a file that is not a skill's SKILL.md", () => {
    expect(classifySkillReach(tc("Read", { file: "src/auth.ts" }))).toBeUndefined();
  });

  it("recognizes a hyphenated tool-style call naming a skill directly", () => {
    expect(classifySkillReach(tc("weaver-refactor"))).toEqual({
      skill: "weaver-refactor",
      via: "tool",
    });
  });

  it("recognizes an underscore tool-style call, normalized to the hyphenated skill name", () => {
    expect(classifySkillReach(tc("weaver_code_inspection"))).toEqual({
      skill: "weaver-code-inspection",
      via: "tool",
    });
  });

  it("normalizes mixed case before matching a tool-style call", () => {
    expect(classifySkillReach(tc("Weaver_Code_Inspection"))).toEqual({
      skill: "weaver-code-inspection",
      via: "tool",
    });
  });

  it("returns undefined for a plain bash call", () => {
    expect(classifySkillReach(tc("bash", { command: "ls" }))).toBeUndefined();
  });

  it("returns undefined for a declared competing tool like Grep", () => {
    expect(classifySkillReach(tc("Grep"))).toBeUndefined();
  });

  it("returns undefined for a hallucinated tool name that is not a skill", () => {
    expect(classifySkillReach(tc("frobnicate"))).toBeUndefined();
  });

  it("does not match a tool name that is a superstring of a skill name", () => {
    expect(classifySkillReach(tc("weaver-refactor-x"))).toBeUndefined();
  });
});

describe("skillContext", () => {
  it("returns each requested skill's full SKILL.md body, joined", () => {
    // Sentinel is the source read function, not hardcoded skill copy: this pins
    // that every requested name is mapped and its whole body (frontmatter
    // included) survives the join, without coupling to shipped prose.
    const prompt = skillContext(["weaver-refactor", "weaver-code-inspection"]);
    expect(prompt).toContain(readSkillFile("weaver-refactor"));
    expect(prompt).toContain(readSkillFile("weaver-code-inspection"));
  });

  it("throws with the skill name when a requested skill file does not exist", () => {
    expect(() => skillContext(["ghost-skill"])).toThrow("ghost-skill");
  });
});
