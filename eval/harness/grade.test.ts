import { describe, expect, it } from "vitest";
import { OPERATION_NAMES } from "../../src/daemon/dispatcher.js";
import { operationToSubcommand } from "./fixtures.js";
import { SUBCOMMAND_MUTABILITY } from "./grade.js";

describe("SUBCOMMAND_MUTABILITY", () => {
  it.each(
    OPERATION_NAMES,
  )("classifies %s's subcommand as mutating or read-only", (operationName) => {
    const subcommand = operationToSubcommand(operationName);
    expect(
      SUBCOMMAND_MUTABILITY[subcommand],
      `Operation "${operationName}" (subcommand "${subcommand}") has no mutability classification in SUBCOMMAND_MUTABILITY. Add one to eval/harness/grade.ts.`,
    ).toBeDefined();
  });

  it.each([
    "rename",
    "move-file",
    "move-directory",
    "move-symbol",
    "extract-function",
    "replace-text",
    "delete-file",
  ])("classifies %s as mutating", (subcommand) => {
    expect(SUBCOMMAND_MUTABILITY[subcommand]).toBe("mutating");
  });

  it.each([
    "find-references",
    "find-importers",
    "get-definition",
    "get-type-errors",
    "search-text",
  ])("classifies %s as read-only", (subcommand) => {
    expect(SUBCOMMAND_MUTABILITY[subcommand]).toBe("read-only");
  });
});
