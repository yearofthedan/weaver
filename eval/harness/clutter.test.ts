import { describe, expect, it } from "vitest";
import { buildClutterSystemPrompt, CLUTTER_CHAR_FLOOR } from "./clutter.js";
import { SKILL_NAMES } from "./context.js";

describe("buildClutterSystemPrompt", () => {
  it("exceeds the documented clutter floor", () => {
    expect(buildClutterSystemPrompt().length).toBeGreaterThanOrEqual(CLUTTER_CHAR_FLOOR);
  });

  it("leaks no weaver-specific text or skill names into the scaffolding", () => {
    const prompt = buildClutterSystemPrompt();
    expect(prompt.toLowerCase()).not.toContain("weaver");
    for (const skillName of SKILL_NAMES) {
      expect(prompt).not.toContain(skillName);
    }
  });
});
