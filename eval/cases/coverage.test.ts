import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPERATION_NAMES } from "../../src/daemon/dispatcher.js";
import { operationToSubcommand } from "../harness/fixtures.js";
import { CASES } from "./cases.js";

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

    // The harness builds a default weaver stub for every operation by eagerly
    // reading its fixture at module load, so a missing fixture would break the
    // whole eval lane with an ENOENT rather than a clear failure here.
    it.each(OPERATION_NAMES)("operation %s has a default fixture", (operationName) => {
      expect(
        fixtureOperations,
        `Operation "${operationName}" has no eval/fixtures/${operationName}.json. Add one — the harness needs a weaver-shaped default stub for every operation.`,
      ).toContain(operationName);
    });

    it.each(
      fixtureOperations,
    )("fixture %s.json corresponds to a registered operation", (fixtureName) => {
      expect(
        fixtureCorrespondsToOperation(fixtureName),
        `Fixture ${fixtureName}.json has no registered operation and is not a focused variant of one (an "<operation>-<detail>" name). Remove the fixture or register the operation.`,
      ).toBe(true);
    });

    it("accepts an exact operation name", () => {
      expect(fixtureCorrespondsToOperation("rename")).toBe(true);
    });

    it("accepts a focused variant of a registered operation", () => {
      expect(fixtureCorrespondsToOperation("searchText-userId")).toBe(true);
    });

    it("rejects a name with no registered operation, exact or as a prefix", () => {
      expect(fixtureCorrespondsToOperation("totallyUnregisteredOperation")).toBe(false);
    });
  });
});

/**
 * True when `fixtureName` is a registered operation's exact camelCase name, or
 * a focused variant of one (`"<operation>-<detail>"`) — a case-scoped stub for
 * a single scenario rather than the operation's generic default fixture.
 */
function fixtureCorrespondsToOperation(fixtureName: string): boolean {
  return (
    OPERATION_NAMES.includes(fixtureName) ||
    OPERATION_NAMES.some((operation) => fixtureName.startsWith(`${operation}-`))
  );
}
