import { describe, expect, it } from "vitest";
import { skillContext, skillFrontmatters } from "./context.js";

describe("skillFrontmatters", () => {
  it("returns name and description for all three shipped skills", () => {
    const frontmatters = skillFrontmatters();
    expect(frontmatters.map((f) => f.name)).toEqual([
      "weaver-search-and-replace",
      "weaver-refactor",
      "weaver-code-inspection",
    ]);
  });

  it("includes each skill's description from the frontmatter", () => {
    const byName = new Map(skillFrontmatters().map((f) => [f.name, f.description]));
    expect(byName.get("weaver-search-and-replace")).toContain(
      "changing a string, pattern, or text",
    );
    expect(byName.get("weaver-refactor")).toContain("renaming a symbol");
    expect(byName.get("weaver-code-inspection")).toContain("finding all usages of a symbol");
  });

  it("does NOT include the full SKILL.md body text in descriptions", () => {
    for (const { description } of skillFrontmatters()) {
      expect(description).not.toContain("weaver search-text");
      expect(description).not.toContain("weaver rename");
      expect(description).not.toContain("weaver find-references");
    }
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
