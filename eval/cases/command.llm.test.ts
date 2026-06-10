import { describe, expect, it } from "vitest";
import { extractBashCommands, matchWeaverCommand } from "../harness/assertions.js";
import { callModel } from "../harness/call-model.js";
import { SKILL_NAMES, skillContext } from "../harness/context.js";
import { BASH_TOOL } from "../harness/tools.js";
import { CASES } from "./cases.js";

/** Single-step command cases (no seed). */
const singleStepCases = CASES.filter((c) => c.stage === "command" && !c.seed);

const systemPrompt = skillContext([...SKILL_NAMES]);
const tools = [BASH_TOOL];

describe("command-stage cases", () => {
  it.each(singleStepCases)("$name — model emits correct weaver command", async (c) => {
    const { subcommand, keyArgs } = c.expect;
    expect(subcommand, "command case must declare expect.subcommand").toBeDefined();
    if (!subcommand) return;

    const response = await callModel(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: c.task },
      ],
      tools,
    );

    const commands = extractBashCommands(response.toolCalls);

    expect(
      commands.length,
      `No bash command emitted for task: "${c.task}". ` +
        `Model responded with text: ${response.text}`,
    ).toBeGreaterThan(0);

    const matches = commands.map((cmd) => matchWeaverCommand(cmd, subcommand, keyArgs));
    const passing = matches.find((m) => m.matched);

    expect(
      passing,
      `No weaver command matched for task: "${c.task}".\n` +
        `Commands emitted:\n${commands.map((cmd, i) => `  [${i}] ${cmd}\n  Reason: ${matches[i]?.reason}`).join("\n")}`,
    ).toBeDefined();
  });
});
