import { describe, expect, it } from "vitest";
import { extractCommandsFromText, matchWeaverCommand } from "../harness/assertions.js";
import { callModel } from "../harness/call-model.js";
import { modelConfig } from "../harness/config.js";
import { SKILL_NAMES, skillContext } from "../harness/context.js";
import { loadFixture, operationToSubcommand } from "../harness/fixtures.js";
import { buildSeedMessages } from "../harness/seed.js";
import { CASES } from "./cases.js";

/** Two-step command cases (have a seed). */
const twoStepCases = CASES.filter((c) => c.stage === "command" && c.seed != null);

const skillContent = skillContext([...SKILL_NAMES]);

describe("two-step flows", () => {
  it.each(twoStepCases)("$name — model emits correct follow-up weaver command", async (c) => {
    const { command, keyArgs } = c.expect;
    expect(command, "two-step case must declare expect.subcommand").toBeDefined();
    expect(c.seed, "two-step case must have a seed").toBeDefined();
    if (!command || !c.seed) return;

    const { operation } = c.seed;
    const step1Command = `weaver ${operationToSubcommand(operation)} '{}'`;
    const seedMessages = buildSeedMessages(
      `${skillContent}\n\n---\n\nTask: ${c.task}`,
      step1Command,
      loadFixture(operation),
    );

    const response = await callModel(seedMessages, [], { ...modelConfig(), temperature: 0 });

    const commands = extractCommandsFromText(response.text);

    expect(
      commands.length,
      `No command emitted after seeing ${operation} results for task: "${c.task}". ` +
        `Model responded with: ${response.text}`,
    ).toBeGreaterThan(0);

    const matches = commands.map((cmd) => matchWeaverCommand(cmd, command, keyArgs));
    const passing = matches.find((m) => m.matched);

    expect(
      passing,
      `No matching weaver follow-up command for task: "${c.task}".\n` +
        `Commands emitted:\n${commands.map((cmd, i) => `  [${i}] ${cmd}\n  Reason: ${matches[i]?.reason}`).join("\n")}`,
    ).toBeDefined();
  });
});
