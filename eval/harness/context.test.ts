import * as fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildAvailableSkillsPrompt,
  readSkillFile,
  SKILL_NAMES,
  skillContext,
  skillFrontmatters,
  skillLocation,
} from "./context.js";

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

  it("re-throws the original error unchanged when the read fails for a reason other than a missing file", () => {
    const eacces = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw eacces;
    });
    expect(() => readSkillFile("weaver-refactor")).toThrow("EACCES: permission denied");
  });

  it("re-throws a thrown value as-is when it carries an ENOENT code but is not an Error instance", () => {
    const nonError = { code: "ENOENT" };
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw nonError;
    });
    let caught: unknown;
    try {
      readSkillFile("weaver-refactor");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(nonError);
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

  it("contains the host-style instruction to invoke a skill as a tool by name", () => {
    const prompt = buildAvailableSkillsPrompt();
    expect(prompt.toLowerCase()).toContain("invoke it as a tool by name");
  });

  it("states that invoking a skill loads its instructions, to be followed via other tools", () => {
    const prompt = buildAvailableSkillsPrompt();
    expect(prompt.toLowerCase()).toContain("loaded into the conversation");
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
