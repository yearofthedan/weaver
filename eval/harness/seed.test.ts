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
  });
});

describe("buildHabitMomentumSeed", () => {
  const TASK = "rename the function processUser to handleAccount in src/";

  it("ends with the task verbatim as the active user turn", () => {
    const messages = buildHabitMomentumSeed(TASK);
    const last = messages[messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toBe(TASK);
  });

  it("primes a grep success in the turns before the task", () => {
    const messages = buildHabitMomentumSeed(TASK);
    const primedGrep = messages
      .slice(0, -1)
      .some((m) => typeof m.content === "string" && m.content.includes("grep"));
    expect(primedGrep).toBe(true);
  });
});
