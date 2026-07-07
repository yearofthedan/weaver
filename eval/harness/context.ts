import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const SKILLS_DIR = path.join(PROJECT_ROOT, ".claude/skills");

export const SKILL_NAMES = [
  "weaver-search-and-replace",
  "weaver-refactor",
  "weaver-code-inspection",
] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export interface SkillFrontmatter {
  name: string;
  description: string;
}

export function readSkillFile(skillName: string): string {
  const skillPath = path.join(SKILLS_DIR, skillName, "SKILL.md");
  try {
    return fs.readFileSync(skillPath, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error(`Skill file not found: ${skillName} (expected at ${skillPath})`);
    }
    throw err;
  }
}

function parseSkillFrontmatter(skillName: string): SkillFrontmatter {
  const content = readSkillFile(skillName);
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new Error(`Skill file has no valid frontmatter: ${skillName}`);
  }
  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s+(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s+(.+)$/m);
  if (!nameMatch || !descMatch) {
    throw new Error(`Skill frontmatter missing name or description: ${skillName}`);
  }
  return { name: nameMatch[1].trim(), description: descMatch[1].trim() };
}

/**
 * Returns each shipped skill's frontmatter (name + description), read from disk
 * at call time. Trigger-stage cases surface these as per-skill tool definitions —
 * the description under test becomes the tool description the model chooses by.
 */
export function skillFrontmatters(): SkillFrontmatter[] {
  return SKILL_NAMES.map((skillName) => parseSkillFrontmatter(skillName));
}

/**
 * Returns the relative path to a skill's SKILL.md file, e.g.
 * `.claude/skills/weaver-refactor/SKILL.md`. This is the single source of
 * truth for the location string used in the `<available_skills>` block and
 * matched by the loop's `isSkillMdRead` predicate.
 */
export function skillLocation(name: string): string {
  return `.claude/skills/${name}/SKILL.md`;
}

/**
 * Builds the `<available_skills>` system-prompt block for the rate lane.
 * Lists each shipped skill's name, verbatim frontmatter description, and
 * SKILL.md location — mirroring how a real host surfaces installed skills.
 * The trailing instruction mirrors the host's skill mechanism: invoking a
 * skill loads its instructions into context; the model then acts on them
 * with its other tools.
 */
export function buildAvailableSkillsPrompt(): string {
  const entries = skillFrontmatters()
    .map(
      ({ name, description }) =>
        `<skill>\n<name>${name}</name>\n<description>${description}</description>\n<location>${skillLocation(name)}</location>\n</skill>`,
    )
    .join("\n");
  return (
    `<available_skills>\n${entries}\n</available_skills>\n\n` +
    "To use a skill, invoke it as a tool by name. Its instructions will be loaded into the conversation; follow them using your other tools (typically bash)."
  );
}

/**
 * Returns a system prompt containing the full SKILL.md content for each named skill.
 * Used for command-stage eval cases where the model needs full instructions.
 *
 * Throws if any requested skill file does not exist on disk.
 */
export function skillContext(skillNames: string[]): string {
  const bodies = skillNames.map((skillName) => readSkillFile(skillName));
  return bodies.join("\n\n---\n\n");
}
