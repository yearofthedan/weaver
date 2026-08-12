import { describe, expect, it } from "vitest";
import {
  buildClutterSystemPrompt,
  buildHostToolUsePolicySection,
  buildToolUsePolicySection,
  CLUTTER_CHAR_FLOOR,
} from "./clutter.js";
import { SKILL_NAMES } from "./context.js";

describe("buildClutterSystemPrompt", () => {
  it("includes the tool-use policy it is given", () => {
    expect(buildClutterSystemPrompt("# Policy\n\nUse tools carefully.")).toContain(
      "# Policy\n\nUse tools carefully.",
    );
  });
});

// Properties of the assembled prompt that would invalidate a run if violated:
// too thin to count as crowded context, or contaminated with the product text
// the lane exists to isolate. The scaffolding's wording carries no contract, so
// nothing here asserts on it.
describe.each([
  ["generic", buildToolUsePolicySection],
  ["host", buildHostToolUsePolicySection],
])("assembled with the %s tool-use policy", (_name, policy) => {
  it("exceeds the documented clutter floor", () => {
    expect(buildClutterSystemPrompt(policy()).length).toBeGreaterThanOrEqual(CLUTTER_CHAR_FLOOR);
  });

  it("leaks no weaver-specific text or skill names into the scaffolding", () => {
    const prompt = buildClutterSystemPrompt(policy());
    expect(prompt.toLowerCase()).not.toContain("weaver");
    for (const skillName of SKILL_NAMES) {
      expect(prompt).not.toContain(skillName);
    }
  });
});
