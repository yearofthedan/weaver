import { describe, expect, it } from "vitest";
import { buildClutterSystemPrompt, CLUTTER_CHAR_FLOOR } from "./clutter.js";
import { SKILL_NAMES } from "./context.js";

describe("buildClutterSystemPrompt", () => {
  describe("length floor", () => {
    it("output length exceeds the documented clutter floor", () => {
      const prompt = buildClutterSystemPrompt();
      expect(prompt.length).toBeGreaterThanOrEqual(CLUTTER_CHAR_FLOOR);
    });

    it("clutter floor constant is at least 12000 characters (approximating 3000 tokens at 4 chars/token)", () => {
      expect(CLUTTER_CHAR_FLOOR).toBeGreaterThanOrEqual(12_000);
    });
  });

  describe("weaver-free content", () => {
    it("output contains no weaver-specific text (case-insensitive)", () => {
      const prompt = buildClutterSystemPrompt();
      expect(prompt.toLowerCase()).not.toContain("weaver");
    });

    it("output contains no skill names", () => {
      const prompt = buildClutterSystemPrompt();
      for (const skillName of SKILL_NAMES) {
        expect(prompt).not.toContain(skillName);
      }
    });
  });

  describe("content structure", () => {
    it("returns a non-empty string", () => {
      const prompt = buildClutterSystemPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("is deterministic across multiple calls", () => {
      const first = buildClutterSystemPrompt();
      const second = buildClutterSystemPrompt();
      expect(first).toBe(second);
    });
  });
});
