import { describe, expect, it } from "vitest";
import { weaverSubcommand } from "./assertions.js";
import { buildHabitMomentumSeed, buildSeedMessages } from "./seed.js";

const FIXTURE_CONTENT = JSON.stringify({ status: "success", matches: [] });
const STEP1_COMMAND = `weaver search-text '{"pattern":"userId"}'`;

describe("buildSeedMessages", () => {
  describe("message shape", () => {
    it("produces exactly three messages", () => {
      const messages = buildSeedMessages("task text", STEP1_COMMAND, FIXTURE_CONTENT);
      expect(messages).toHaveLength(3);
    });

    it("first message is the user task", () => {
      const messages = buildSeedMessages(
        "rename userId to accountId",
        STEP1_COMMAND,
        FIXTURE_CONTENT,
      );
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("rename userId to accountId");
    });

    it("second message is the assistant turn with a single bash tool call for the step-1 command", () => {
      const messages = buildSeedMessages("task", STEP1_COMMAND, FIXTURE_CONTENT);
      expect(messages[1].role).toBe("assistant");
      expect(messages[1].tool_calls).toHaveLength(1);
      const call = messages[1].tool_calls?.[0];
      expect(call?.name).toBe("bash");
      expect(call?.arguments.command).toBe(STEP1_COMMAND);
      expect(call?.id).toBeDefined();
    });

    it("third message is a tool turn matching the step-1 call id and carrying the fixture", () => {
      const messages = buildSeedMessages("task", STEP1_COMMAND, FIXTURE_CONTENT);
      const call = messages[1].tool_calls?.[0];
      expect(messages[2].role).toBe("tool");
      expect(messages[2].tool_call_id).toBe(call?.id);
      expect(messages[2].content).toBe(FIXTURE_CONTENT);
    });
  });

  describe("fixture embedding", () => {
    it("embeds the fixture content verbatim", () => {
      const fixture = '{"status":"success","matches":[{"file":"src/a.ts","line":5}]}';
      const messages = buildSeedMessages("task", STEP1_COMMAND, fixture);
      expect(messages[2].content).toContain(fixture);
    });
  });
});

describe("buildHabitMomentumSeed", () => {
  const TASK = "rename the function processUser to handleAccount in src/";

  describe("turns omitted", () => {
    it("defaults to one pre-step, producing five messages", () => {
      const messages = buildHabitMomentumSeed(TASK);
      expect(messages).toHaveLength(5);
    });

    it("ends with the task verbatim as the active user turn", () => {
      const messages = buildHabitMomentumSeed(TASK);
      const last = messages[messages.length - 1];
      expect(last.role).toBe("user");
      expect(last.content).toBe(TASK);
    });
  });

  describe("turns = 0", () => {
    it("produces exactly the task turn with no seeded pre-steps", () => {
      const messages = buildHabitMomentumSeed(TASK, 0);
      expect(messages).toEqual([{ role: "user", content: TASK }]);
    });
  });

  describe("turns = 2", () => {
    it("produces nine messages ending in the task", () => {
      const messages = buildHabitMomentumSeed(TASK, 2);
      expect(messages).toHaveLength(9);
      expect(messages[8]).toEqual({ role: "user", content: TASK });
    });

    it("seeds two distinct bash commands drawn from the true-shell pool", () => {
      const messages = buildHabitMomentumSeed(TASK, 2);
      const commands = messages
        .filter((m) => m.role === "assistant" && m.tool_calls)
        .map((m) => String(m.tool_calls?.[0]?.arguments.command));
      expect(commands).toHaveLength(2);
      expect(new Set(commands).size).toBe(2);
    });

    it("follows the standard user/assistant-bash/tool/assistant cycle per pre-step", () => {
      const messages = buildHabitMomentumSeed(TASK, 2);
      expect(messages.slice(0, 4).map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "assistant",
      ]);
      expect(messages.slice(4, 8).map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "assistant",
      ]);
    });

    it("matches each tool result's tool_call_id to its preceding bash call", () => {
      const messages = buildHabitMomentumSeed(TASK, 2);
      const firstCallId = messages[1].tool_calls?.[0]?.id;
      const secondCallId = messages[5].tool_calls?.[0]?.id;
      expect(messages[2].tool_call_id).toBe(firstCallId);
      expect(messages[6].tool_call_id).toBe(secondCallId);
      expect(firstCallId).not.toBe(secondCallId);
    });
  });

  describe("turns beyond the pool size", () => {
    it("throws instead of cycling or under-seeding", () => {
      expect(() => buildHabitMomentumSeed(TASK, 4)).toThrow(/4/);
    });
  });

  describe("anti-substitution guard", () => {
    it("every seeded bash command is a true shell tool, never a weaver invocation", () => {
      const messages = buildHabitMomentumSeed(TASK, 3);
      const commands = messages
        .filter((m) => m.role === "assistant" && m.tool_calls)
        .map((m) => String(m.tool_calls?.[0]?.arguments.command));
      expect(commands).toHaveLength(3);
      for (const command of commands) {
        expect(weaverSubcommand(command)).toBeUndefined();
        expect(/^(grep|git|find)\b/.test(command)).toBe(true);
      }
    });
  });
});
