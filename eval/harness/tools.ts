import type { ToolDefinition } from "./call-model.js";

/**
 * The "skill" tool used in trigger-stage cases.
 * The model must invoke this to select the correct skill before seeing
 * the full SKILL.md content.
 */
export const SKILL_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "skill",
    description: "Load a skill by name to get its full instructions.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the skill to load.",
        },
      },
      required: ["name"],
    },
  },
};

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
