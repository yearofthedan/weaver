import { describe, expect, it } from "vitest";
import { extractBashCommands, matchWeaverCommand } from "../harness/assertions.js";
import { callModel } from "../harness/call-model.js";
import { modelConfig } from "../harness/config.js";
import { SKILL_NAMES, skillContext } from "../harness/context.js";
import { BASH_TOOL } from "../harness/tools.js";
import { CASES } from "./cases.js";

/** Single-step command cases (no seed). */
const singleStepCases = CASES.filter((c) => c.stage === "command" && !c.seed);

const skillContent = skillContext([...SKILL_NAMES]);

function commandPrompt(task: string): string {
  // Constrain to a single call so the lane measures the one command the model
  // commits to, not a precursor it would take first. Deliberately does not name
  // weaver — the model must still select it from the skill content above.
  return `${skillContent}\n\n---\n\nTask: ${task}\n\nUse the bash tool to make a single call that accomplishes this task.`;
}

describe("command-stage cases", () => {
  it.each(singleStepCases)("$name — model emits correct weaver command", async (c) => {
    const { command, keyArgs } = c.expect;
    expect(command, "command case must declare expect.subcommand").toBeDefined();
    if (!command) return;

    const response = await callModel(
      [{ role: "user", content: commandPrompt(c.task) }],
      [BASH_TOOL],
      { ...modelConfig(), temperature: 0 },
    );

    const commands = extractBashCommands(response.toolCalls);

    expect(
      commands.length,
      `did not call the bash tool for task: "${c.task}". Model responded with text: ${response.text}`,
    ).toBeGreaterThan(0);

    const matches = commands.map((cmd) => matchWeaverCommand(cmd, command, keyArgs));
    const passing = matches.find((m) => m.matched);

    expect(
      passing,
      `No weaver command matched for task: "${c.task}".\n` +
        `Commands emitted:\n${commands.map((cmd, i) => `  [${i}] ${cmd}\n  Reason: ${matches[i]?.reason}`).join("\n")}`,
    ).toBeDefined();
  });
});
