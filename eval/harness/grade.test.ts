import { describe, expect, it } from "vitest";
import { OPERATION_NAMES } from "../../src/daemon/dispatcher.js";
import type { ToolCall } from "./call-model.js";
import { operationToSubcommand } from "./fixtures.js";
import { isMutatingCompetitor, SUBCOMMAND_MUTABILITY } from "./grade.js";

const bashCall = (command: string): ToolCall => ({ name: "bash", arguments: { command } });
const tc = (name: string): ToolCall => ({ name, arguments: {} });

describe("SUBCOMMAND_MUTABILITY", () => {
  it.each(OPERATION_NAMES)(
    "classifies %s's subcommand as mutating or read-only",
    (operationName) => {
      const subcommand = operationToSubcommand(operationName);
      expect(
        SUBCOMMAND_MUTABILITY[subcommand],
        `Operation "${operationName}" (subcommand "${subcommand}") has no mutability classification in SUBCOMMAND_MUTABILITY. Add one to eval/harness/grade.ts.`,
      ).toBeDefined();
    },
  );

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

describe("isMutatingCompetitor", () => {
  it("returns false when the call is the expected command", () => {
    expect(isMutatingCompetitor(bashCall("weaver rename '{}'"), "rename")).toBe(false);
  });

  it("returns true when the call is a different mutating subcommand", () => {
    expect(isMutatingCompetitor(bashCall("weaver move-file '{}'"), "rename")).toBe(true);
  });

  it("returns false when the call is a read-only subcommand", () => {
    expect(isMutatingCompetitor(bashCall("weaver find-references '{}'"), "rename")).toBe(false);
  });

  it("returns false for a non-weaver bash call", () => {
    expect(isMutatingCompetitor(bashCall("grep -r userId src"), "rename")).toBe(false);
  });

  it("returns false for a non-bash tool call", () => {
    expect(isMutatingCompetitor(tc("Grep"), "rename")).toBe(false);
  });

  it("detects a mutating competitor after a cd && chain", () => {
    expect(
      isMutatingCompetitor(bashCall("cd /tmp/weaver-eval && weaver replace-text '{}'"), "rename"),
    ).toBe(true);
  });

  it("returns false for the expected command after a cd && chain", () => {
    expect(
      isMutatingCompetitor(bashCall("cd /tmp/weaver-eval && weaver rename '{}'"), "rename"),
    ).toBe(false);
  });
});
