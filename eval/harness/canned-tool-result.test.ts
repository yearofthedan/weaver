import { describe, expect, it } from "vitest";
import { cannedToolResult, resolveCannedResult } from "./agentic-loop.js";
import type { ToolCall } from "./call-model.js";
import { loadFixture } from "./fixtures.js";
import { BASH_TOOL, COMPETING_TOOLS } from "./tools.js";

const tc = (name: string): ToolCall => ({ name, arguments: {} });
const bashCall = (command: string): ToolCall => ({ name: "bash", arguments: { command } });

describe("cannedToolResult", () => {
  const laneToolNames = [...COMPETING_TOOLS.map((t) => t.function.name), BASH_TOOL.function.name];

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

describe("resolveCannedResult", () => {
  const declared = ["Skill", "bash", "Grep", "Glob", "Read"];

  it("returns a host no-such-tool error for a hallucinated tool name, in any separator style, without throwing", () => {
    // weaver_code_inspection is the underscore variant a provider emitted that
    // crashed the lane; weaver-code-inspection and frobnicate confirm the guard
    // is not skill-name-specific — any undeclared name is treated as invented.
    for (const name of ["weaver_code_inspection", "weaver-code-inspection", "frobnicate"]) {
      expect(resolveCannedResult(tc(name), declared)).toContain(`no such tool "${name}"`);
    }
  });

  it("lists the declared tools in the unknown-tool error", () => {
    expect(resolveCannedResult(tc("mystery"), declared)).toContain(
      "Available tools: Skill, bash, Grep, Glob, Read.",
    );
  });

  it("routes a declared tool to its canned result", () => {
    expect(resolveCannedResult(tc("Grep"), declared)).toBe(cannedToolResult(tc("Grep")));
  });

  it("honours a per-case override for a declared tool", () => {
    expect(resolveCannedResult(tc("Grep"), declared, { Grep: "OVERRIDE" })).toBe("OVERRIDE");
  });

  it("still throws for a declared tool with no canned result — a harness drift is kept loud", () => {
    expect(() => resolveCannedResult(tc("Ghost"), ["Ghost"])).toThrow(/Ghost/);
  });
});
