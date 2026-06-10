import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const SKILLS_DIR = path.join(PROJECT_ROOT, ".claude/skills");

export const SKILL_NAMES = ["search-and-replace", "refactor", "code-inspection"] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

interface SkillFrontmatter {
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
 * Returns a system prompt listing each shipped skill's name and description only.
 * Used for trigger-stage eval cases where the model must choose a skill without
 * seeing its full instructions.
 */
export function triggerContext(): string {
  const lines = SKILL_NAMES.map((skillName) => {
    const { name, description } = parseSkillFrontmatter(skillName);
    return `- ${name}: ${description}`;
  });
  return `Available skills:\n${lines.join("\n")}`;
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
