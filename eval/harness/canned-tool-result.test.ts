import { describe, expect, it } from "vitest";
import { cannedToolResult } from "./agentic-loop.js";
import type { ToolCall } from "./call-model.js";
import { SKILL_NAMES } from "./context.js";
import { loadFixture } from "./fixtures.js";
import { BASH_TOOL, COMPETING_TOOLS } from "./tools.js";

const tc = (name: string): ToolCall => ({ name, arguments: {} });
const bashCall = (command: string): ToolCall => ({ name: "bash", arguments: { command } });

describe("cannedToolResult", () => {
  const laneToolNames = [
    ...SKILL_NAMES,
    ...COMPETING_TOOLS.map((t) => t.function.name),
    BASH_TOOL.function.name,
  ];

  const GENERIC_FILE_LIST = "src/auth.ts\nsrc/api.ts\nsrc/utils.ts";
  const GREP_STUB = "src/auth.ts:12:  userId\nsrc/api.ts:8:  userId";

  it.each(laneToolNames)("returns a non-empty canned result for %s", (name) => {
    expect(cannedToolResult(tc(name))).toBeTruthy();
  });

  it("throws for an unknown tool name", () => {
    expect(() => cannedToolResult(tc("unknownTool"))).toThrow(/unknownTool/);
  });

  describe("weaver bash calls", () => {
    const NEUTRAL_WEAVER_RESULT = "No results for this call.";

    it("prefers a per-case override over the neutral stub", () => {
      const result = cannedToolResult(bashCall("weaver rename '{}'"), { rename: "CUSTOM STUB" });
      expect(result).toBe("CUSTOM STUB");
    });

    it("resolves to the neutral stub, not the operation's fixture, when the case does not own the subcommand", () => {
      const result = cannedToolResult(bashCall('weaver rename \'{"newName":"accountId"}\''));
      expect(result).toBe(NEUTRAL_WEAVER_RESULT);
      expect(result).not.toBe(loadFixture("rename.json"));
    });

    it("resolves an unregistered subcommand to the same neutral stub rather than throwing", () => {
      const result = cannedToolResult(bashCall("weaver bogus-command '{}'"));
      expect(result).toBe(NEUTRAL_WEAVER_RESULT);
    });

    it("never returns the generic bash file list for a weaver call", () => {
      const result = cannedToolResult(bashCall("weaver rename '{}'"));
      expect(result).not.toBe(GENERIC_FILE_LIST);
    });
  });

  describe("non-weaver bash calls", () => {
    it("returns the generic file list when no case override exists", () => {
      expect(cannedToolResult(bashCall("mkdir -p /tmp/weaver-eval/src/generated"))).toBe(
        GENERIC_FILE_LIST,
      );
    });

    it("prefers a per-case override over the generic file list", () => {
      const result = cannedToolResult(bashCall("ls -la"), { bash: "CUSTOM BASH STUB" });
      expect(result).toBe("CUSTOM BASH STUB");
    });
  });

  describe("non-bash tools with a case override", () => {
    it("prefers the case override over the global canned result", () => {
      const result = cannedToolResult(tc("Grep"), { Grep: "CUSTOM GREP STUB" });
      expect(result).toBe("CUSTOM GREP STUB");
    });

    it("falls back to the global canned result when the case has no override", () => {
      expect(cannedToolResult(tc("Grep"), { Read: "unrelated" })).toBe(GREP_STUB);
    });
  });
});
