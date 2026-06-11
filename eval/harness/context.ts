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

function readSkillFile(skillName: string): string {
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
 * Returns a system prompt containing the full SKILL.md content for each named skill.
 * Used for command-stage eval cases where the model needs full instructions.
 *
 * Throws if any requested skill file does not exist on disk.
 */
export function skillContext(skillNames: string[]): string {
  const bodies = skillNames.map((skillName) => readSkillFile(skillName));
  return bodies.join("\n\n---\n\n");
}
