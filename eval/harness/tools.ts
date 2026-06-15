import type { ToolDefinition } from "./call-model.js";
import { skillFrontmatters } from "./context.js";

/**
 * One tool per shipped skill, used in trigger-stage cases. The tool description
 * is the skill's frontmatter description — the artifact under test. Small local
 * models cannot route "use skill X" through an indirect skill(name) tool (they
 * emit a call to an undeclared function named X, which the server drops), so
 * each skill is declared as its own callable tool instead.
 */
export function skillTools(): ToolDefinition[] {
  return skillFrontmatters().map(({ name, description }) => ({
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties: {} },
    },
  }));
}

/**
 * Competing host-provided tools for the adversarial trigger lane.
 * These represent the generic editing and search tools a real agent host would
 * expose alongside weaver's skills, creating realistic tool-selection pressure.
 * None of these names may collide with a skill name or "bash" — a collision
 * would make pass/fail in the poisoned lane ambiguous.
 */
export const COMPETING_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "Edit",
      description: "Edit a file by replacing a specific string with a new string.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "Path to the file to edit." },
          old_string: { type: "string", description: "The text to replace." },
          new_string: { type: "string", description: "The replacement text." },
        },
        required: ["file", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Grep",
      description: "Search file contents with a regex across the project.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for." },
          path: { type: "string", description: "Directory or file path to search within." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Glob",
      description: "Find files matching a glob pattern in the workspace.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern to match files against." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Read",
      description: "Read the contents of a file.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "Path to the file to read." },
        },
        required: ["file"],
      },
    },
  },
];

/**
 * The bash tool used in both trigger-stage and command-stage cases.
 * In trigger cases it's present as a tempting alternative to using the skill.
 * In command cases it's the only tool — the model must emit a weaver command.
 */
export const BASH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "bash",
    description: "Run a shell command and return its stdout.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute.",
        },
      },
      required: ["command"],
    },
  },
};
