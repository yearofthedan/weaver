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
