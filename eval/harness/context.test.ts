import { describe, expect, it } from "vitest";
import {
  buildAvailableSkillsPrompt,
  SKILL_NAMES,
  skillContext,
  skillFrontmatters,
  skillLocation,
} from "./context.js";

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

  it("does NOT include the full SKILL.md body text in descriptions", () => {
    for (const { description } of skillFrontmatters()) {
      expect(description).not.toContain("weaver search-text");
      expect(description).not.toContain("weaver rename");
      expect(description).not.toContain("weaver find-references");
    }
  });
});

describe("skillLocation", () => {
  it("returns the relative SKILL.md path for a skill name", () => {
    expect(skillLocation("weaver-refactor")).toBe(".claude/skills/weaver-refactor/SKILL.md");
  });

  it("returns distinct paths for each shipped skill", () => {
    const paths = SKILL_NAMES.map(skillLocation);
    const unique = new Set(paths);
    expect(unique.size).toBe(SKILL_NAMES.length);
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

  it("contains the framing instruction that skills are not callable tools", () => {
    const prompt = buildAvailableSkillsPrompt();
    expect(prompt.toLowerCase()).toContain("not callable tools");
  });

  it("instructs reading the SKILL.md and acting via existing tools", () => {
    const prompt = buildAvailableSkillsPrompt();
    expect(prompt).toContain("SKILL.md");
    expect(prompt.toLowerCase()).toContain("bash");
  });
});

describe("skillContext", () => {
  it("returns the full SKILL.md body for the requested skills", () => {
    const prompt = skillContext(["weaver-refactor"]);
    expect(prompt).toContain("weaver rename");
    expect(prompt).toContain("weaver move-file");
  });

  it("includes content for each named skill when multiple are requested", () => {
    const prompt = skillContext(["weaver-refactor", "weaver-code-inspection"]);
    expect(prompt).toContain("weaver rename");
    expect(prompt).toContain("weaver find-references");
  });

  it("does NOT include content for unrequested skills", () => {
    const prompt = skillContext(["weaver-refactor"]);
    expect(prompt).not.toContain("weaver search-text");
    expect(prompt).not.toContain("weaver replace-text");
  });

  it("throws when a named skill file does not exist", () => {
    expect(() => skillContext(["nonexistent-skill"])).toThrow();
  });

  it("throws with the skill name in the error message", () => {
    expect(() => skillContext(["ghost-skill"])).toThrow("ghost-skill");
  });

  it("includes the frontmatter in the returned content", () => {
    const prompt = skillContext(["weaver-search-and-replace"]);
    expect(prompt).toContain("name: weaver-search-and-replace");
  });
});
