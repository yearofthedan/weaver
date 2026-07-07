import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPERATION_NAMES } from "../../src/daemon/dispatcher.js";
import { CASES, operationToSubcommand } from "./cases.js";

const FIXTURES_DIR = join(import.meta.dirname, "../fixtures");

const commandCases = CASES.filter((c) => c.stage === "command");
const commandSubcommands = new Set(commandCases.map((c) => c.expect.command).filter(Boolean));

describe("eval case coverage", () => {
  describe("operation coverage", () => {
    it.each(
      OPERATION_NAMES,
    )("operation %s has at least one command-stage case", (operationName) => {
      const expectedSubcommand = operationToSubcommand(operationName);
      expect(
        commandSubcommands.has(expectedSubcommand),
        `No command-stage case for operation "${operationName}" (subcommand: "${expectedSubcommand}"). Add a case to eval/cases/cases.ts.`,
      ).toBe(true);
    });
  });

  describe("fixture coverage", () => {
    const fixtureOperations = readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));

    it.each(
      fixtureOperations,
    )("fixture %s.json corresponds to a registered operation", (fixtureName) => {
      expect(
        OPERATION_NAMES,
        `Fixture ${fixtureName}.json has no registered operation. Remove the fixture or register the operation.`,
      ).toContain(fixtureName);
    });
  });
});
