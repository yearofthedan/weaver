import { describe, expect, it } from "vitest";
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

    it("second message is the assistant turn containing the step-1 command", () => {
      const messages = buildSeedMessages("task", STEP1_COMMAND, FIXTURE_CONTENT);
      expect(messages[1].role).toBe("assistant");
      expect(messages[1].content).toBe(STEP1_COMMAND);
    });

    it("third message is a user turn presenting the command output", () => {
      const messages = buildSeedMessages("task", STEP1_COMMAND, FIXTURE_CONTENT);
      expect(messages[2].role).toBe("user");
      expect(messages[2].content).toContain(STEP1_COMMAND);
      expect(messages[2].content).toContain(FIXTURE_CONTENT);
    });

    it("third message asks for a single command with no markdown", () => {
      const messages = buildSeedMessages("task", STEP1_COMMAND, FIXTURE_CONTENT);
      expect(messages[2].content).toContain("ONLY the single shell command");
      expect(messages[2].content).toContain("No explanation, no markdown.");
    });
  });

  describe("fixture embedding", () => {
    it("embeds the fixture content verbatim", () => {
      const fixture = '{"status":"success","matches":[{"file":"src/a.ts","line":5}]}';
      const messages = buildSeedMessages("task", STEP1_COMMAND, fixture);
      expect(messages[2].content).toContain(fixture);
    });

    it("does not modify or parse the fixture JSON", () => {
      const fixture = '{"status":"success","foo":42}';
      const messages = buildSeedMessages("task", STEP1_COMMAND, fixture);
      expect(messages[2].content).toContain(fixture);
    });
  });
});

describe("buildHabitMomentumSeed", () => {
  const TASK = "rename the function processUser to handleAccount in src/";

  describe("message shape", () => {
    it("produces exactly four messages", () => {
      const messages = buildHabitMomentumSeed(TASK);
      expect(messages).toHaveLength(4);
    });

    it("roles are user, assistant, user, user in that order", () => {
      const messages = buildHabitMomentumSeed(TASK);
      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");
      expect(messages[2].role).toBe("user");
      expect(messages[3].role).toBe("user");
    });

    it("first turn is an unrelated search request (user)", () => {
      const messages = buildHabitMomentumSeed(TASK);
      expect(messages[0].role).toBe("user");
      expect(typeof messages[0].content).toBe("string");
      expect((messages[0].content as string).length).toBeGreaterThan(0);
    });

    it("second turn contains a grep -rn invocation (assistant)", () => {
      const messages = buildHabitMomentumSeed(TASK);
      expect(messages[1].role).toBe("assistant");
      expect(messages[1].content).toContain("grep");
    });

    it("third turn presents canned grep output (user)", () => {
      const messages = buildHabitMomentumSeed(TASK);
      expect(messages[2].role).toBe("user");
      expect(typeof messages[2].content).toBe("string");
      expect((messages[2].content as string).length).toBeGreaterThan(0);
    });

    it("fourth turn content is the passed task verbatim with no extra framing", () => {
      const messages = buildHabitMomentumSeed(TASK);
      expect(messages[3].role).toBe("user");
      expect(messages[3].content).toBe(TASK);
    });

    it("fourth turn content equals the passed task exactly for any task string", () => {
      const customTask = "find all TODO comments in src/utils/";
      const messages = buildHabitMomentumSeed(customTask);
      expect(messages[3].content).toBe(customTask);
    });
  });
});
