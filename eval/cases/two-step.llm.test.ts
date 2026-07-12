import { describe, expect, it } from "vitest";
import { extractBashCommands, matchWeaverCommand } from "../harness/assertions.js";
import { callModel } from "../harness/call-model.js";
import { modelConfig } from "../harness/config.js";
import { SKILL_NAMES, skillContext } from "../harness/context.js";
import { loadFixture } from "../harness/fixtures.js";
import { buildSeedMessages } from "../harness/seed.js";
import { BASH_TOOL } from "../harness/tools.js";
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

    const seedMessages = buildSeedMessages(
      `${skillContent}\n\n---\n\nTask: ${c.task}`,
      c.seed.step1Command,
      loadFixture(c.seed.fixture),
    );

    const response = await callModel(seedMessages, [BASH_TOOL], {
      ...modelConfig(),
      temperature: 0,
    });

    const commands = extractBashCommands(response.toolCalls);

    expect(
      commands.length,
      `did not call the bash tool after seeing the search-text result for task: "${c.task}". ` +
        `Model responded with text: ${response.text}`,
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
