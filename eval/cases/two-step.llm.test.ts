import { describe, expect, it } from "vitest";
import { extractBashCommands, matchWeaverCommand } from "../harness/assertions.js";
import { callModel } from "../harness/call-model.js";
import { skillContext } from "../harness/context.js";
import { buildSeedMessages } from "../harness/seed.js";
import { BASH_TOOL } from "../harness/tools.js";
import { CASES, loadFixture } from "./cases.js";

/** Two-step command cases (have a seed). */
const twoStepCases = CASES.filter((c) => c.stage === "command" && c.seed != null);

const systemPrompt = skillContext(["search-and-replace", "refactor", "code-inspection"]);
const tools = [BASH_TOOL];

describe("two-step flows", () => {
  it.each(twoStepCases)("$name — model emits correct follow-up weaver command", async (c) => {
    const { subcommand, keyArgs } = c.expect;
    expect(subcommand, "two-step case must declare expect.subcommand").toBeDefined();
    expect(c.seed, "two-step case must have a seed").toBeDefined();
    if (!subcommand || !c.seed) return;

    const { operation } = c.seed;
    const fixtureContent = loadFixture(operation);

    const step1ToolCall = {
      id: "step1_call",
      name: "bash",
      arguments: {
        command: `weaver ${operationToSubcommand(operation)} '{}'`,
      },
    };

    const seedMessages = buildSeedMessages(c.task, step1ToolCall, fixtureContent);

    const response = await callModel(
      [{ role: "system", content: systemPrompt }, ...seedMessages],
      tools,
    );

    const commands = extractBashCommands(response.toolCalls);

    expect(
      commands.length,
      `No bash command emitted after seeing ${operation} results for task: "${c.task}". ` +
        `Model responded with text: ${response.text}`,
    ).toBeGreaterThan(0);

    const matches = commands.map((cmd) => matchWeaverCommand(cmd, subcommand, keyArgs));
    const passing = matches.find((m) => m.matched);

    expect(
      passing,
      `No matching weaver follow-up command for task: "${c.task}".\n` +
        `Commands emitted:\n${commands.map((cmd, i) => `  [${i}] ${cmd}\n  Reason: ${matches[i]?.reason}`).join("\n")}`,
    ).toBeDefined();
  });
});

function operationToSubcommand(operation: string): string {
  return operation.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`);
}
