import { describe, expect, it } from "vitest";
import { skillContext, triggerContext } from "./context.js";

describe("triggerContext", () => {
  it("returns a prompt listing all three shipped skills by name", () => {
    const prompt = triggerContext();
    expect(prompt).toContain("search-and-replace");
    expect(prompt).toContain("refactor");
    expect(prompt).toContain("code-inspection");
  });

  it("includes each skill's description from the frontmatter", () => {
    const prompt = triggerContext();
    expect(prompt).toContain("changing a string, pattern, or text");
    expect(prompt).toContain("renaming a symbol");
    expect(prompt).toContain("finding all usages of a symbol");
  });

  it("does NOT include the full SKILL.md body text", () => {
    const prompt = triggerContext();
    expect(prompt).not.toContain("weaver search-text");
    expect(prompt).not.toContain("weaver rename");
    expect(prompt).not.toContain("weaver find-references");
  });

  it("formats each skill as a name and description on the same line", () => {
    const prompt = triggerContext();
    const lines = prompt.split("\n");
    const searchLine = lines.find((l) => l.includes("search-and-replace"));
    const refactorLine = lines.find((l) => l.includes("refactor"));
    const inspectionLine = lines.find((l) => l.includes("code-inspection"));
    expect(searchLine).toContain("changing a string");
    expect(refactorLine).toContain("renaming a symbol");
    expect(inspectionLine).toContain("finding all usages");
  });
});

describe("skillContext", () => {
  it("returns the full SKILL.md body for the requested skills", () => {
    const prompt = skillContext(["refactor"]);
    expect(prompt).toContain("weaver rename");
    expect(prompt).toContain("weaver move-file");
  });

  it("includes content for each named skill when multiple are requested", () => {
    const prompt = skillContext(["refactor", "code-inspection"]);
    expect(prompt).toContain("weaver rename");
    expect(prompt).toContain("weaver find-references");
  });

  it("does NOT include content for unrequested skills", () => {
    const prompt = skillContext(["refactor"]);
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
    const prompt = skillContext(["search-and-replace"]);
    expect(prompt).toContain("name: search-and-replace");
  });
});
