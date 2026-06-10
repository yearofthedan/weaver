import { describe, expect, it } from "vitest";
import type { ToolCall } from "./call-model.js";
import { buildSeedMessages } from "./seed.js";

const FIXTURE_CONTENT = JSON.stringify({ status: "success", matches: [] });

function makeToolCall(overrides?: Partial<ToolCall>): ToolCall {
  return {
    id: "call_001",
    name: "bash",
    arguments: { command: 'weaver search-text \'{"pattern":"userId"}\'' },
    ...overrides,
  };
}

describe("buildSeedMessages", () => {
  describe("message shape", () => {
    it("produces exactly three messages", () => {
      const messages = buildSeedMessages("task text", makeToolCall(), FIXTURE_CONTENT);
      expect(messages).toHaveLength(3);
    });

    it("first message is the user task", () => {
      const messages = buildSeedMessages(
        "rename userId to accountId",
        makeToolCall(),
        FIXTURE_CONTENT,
      );
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("rename userId to accountId");
    });

    it("second message is the assistant tool_use with the step-1 call", () => {
      const toolCall = makeToolCall({
        name: "bash",
        arguments: { command: "weaver search-text '{}'" },
      });
      const messages = buildSeedMessages("task", toolCall, FIXTURE_CONTENT);
      expect(messages[1].role).toBe("assistant");
      expect(messages[1].content).toBeNull();
      expect(messages[1].tool_calls).toHaveLength(1);
      expect(messages[1].tool_calls?.[0].name).toBe("bash");
    });

    it("third message is the tool result with the fixture content", () => {
      const messages = buildSeedMessages("task", makeToolCall(), FIXTURE_CONTENT);
      expect(messages[2].role).toBe("tool");
      expect(messages[2].content).toBe(FIXTURE_CONTENT);
    });

    it("tool_call_id on the result matches the id from the tool call", () => {
      const toolCall = makeToolCall({ id: "call_xyz" });
      const messages = buildSeedMessages("task", toolCall, FIXTURE_CONTENT);
      expect(messages[2].tool_call_id).toBe("call_xyz");
    });

    it("uses a fallback id when the tool call has no id", () => {
      const toolCall = makeToolCall({ id: undefined });
      const messages = buildSeedMessages("task", toolCall, FIXTURE_CONTENT);
      const resultMsg = messages[2];
      expect(resultMsg.tool_call_id).toBeDefined();
      expect(typeof resultMsg.tool_call_id).toBe("string");
      expect(resultMsg.tool_call_id?.length).toBeGreaterThan(0);
    });
  });

  describe("fixture embedding", () => {
    it("embeds the fixture content verbatim in the tool result", () => {
      const fixture = '{"status":"success","matches":[{"file":"src/a.ts","line":5}]}';
      const messages = buildSeedMessages("task", makeToolCall(), fixture);
      expect(messages[2].content).toBe(fixture);
    });

    it("does not modify or parse the fixture JSON", () => {
      const fixture = '{"status":"success","foo":42}';
      const messages = buildSeedMessages("task", makeToolCall(), fixture);
      expect(messages[2].content).toBe(fixture);
    });
  });
});
