import { afterEach, describe, expect, it } from "vitest";
import {
  formatRunHeader,
  GATING_MODELS,
  isCleanMode,
  isHostClutterMode,
  modelConfig,
} from "./config.js";

afterEach(() => {
  delete process.env.WEAVER_EVAL_BASE_URL;
  delete process.env.WEAVER_EVAL_MODEL;
  delete process.env.WEAVER_EVAL_API_KEY;
  delete process.env.WEAVER_EVAL_TEMPERATURE;
  delete process.env.WEAVER_EVAL_CLEAN;
  delete process.env.WEAVER_EVAL_HOST_CLUTTER;
});

describe("modelConfig", () => {
  describe("temperature", () => {
    it("leaves temperature undefined when WEAVER_EVAL_TEMPERATURE is not set", () => {
      const config = modelConfig();
      expect(config.temperature).toBeUndefined();
    });

    it("parses WEAVER_EVAL_TEMPERATURE as a number when set", () => {
      process.env.WEAVER_EVAL_TEMPERATURE = "0.3";
      const config = modelConfig();
      expect(config.temperature).toBe(0.3);
    });

    it("returns 0 when WEAVER_EVAL_TEMPERATURE is set to 0 — not falling back to undefined", () => {
      process.env.WEAVER_EVAL_TEMPERATURE = "0";
      const config = modelConfig();
      expect(config.temperature).toBe(0);
    });

    it("leaves temperature undefined when WEAVER_EVAL_TEMPERATURE is blank — not Number('') === 0", () => {
      process.env.WEAVER_EVAL_TEMPERATURE = "";
      const config = modelConfig();
      expect(config.temperature).toBeUndefined();
    });

    it("throws when WEAVER_EVAL_TEMPERATURE is set to a non-numeric value", () => {
      process.env.WEAVER_EVAL_TEMPERATURE = "hot";
      expect(() => modelConfig()).toThrow(/finite number/);
    });
  });

  describe("other fields", () => {
    it("returns all three model config fields", () => {
      process.env.WEAVER_EVAL_BASE_URL = "http://openrouter:8080/v1";
      process.env.WEAVER_EVAL_MODEL = "anthropic/claude-haiku-4.5";
      process.env.WEAVER_EVAL_API_KEY = "sk-or-test";
      const config = modelConfig();
      expect(config.baseUrl).toBe("http://openrouter:8080/v1");
      expect(config.model).toBe("anthropic/claude-haiku-4.5");
      expect(config.apiKey).toBe("sk-or-test");
    });
  });
});

describe("GATING_MODELS", () => {
  it("names the three gating models with their base trial counts", () => {
    expect(GATING_MODELS).toEqual([
      { id: "anthropic/claude-haiku-4.5", baseTrials: 3 },
      { id: "google/gemini-2.5-flash", baseTrials: 10 },
      { id: "openai/gpt-5.6-luna", baseTrials: 10 },
    ]);
  });

  it("is non-empty, has no duplicate ids, and every base trial count is positive", () => {
    expect(GATING_MODELS.length).toBeGreaterThan(0);

    const ids = GATING_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const model of GATING_MODELS) {
      expect(model.baseTrials).toBeGreaterThan(0);
    }
  });
});

describe("isCleanMode", () => {
  it("returns false when WEAVER_EVAL_CLEAN is not set", () => {
    expect(isCleanMode()).toBe(false);
  });

  it("returns true when WEAVER_EVAL_CLEAN is exactly '1'", () => {
    process.env.WEAVER_EVAL_CLEAN = "1";
    expect(isCleanMode()).toBe(true);
  });

  it("returns false for any other value, staying pressured on a malformed setting", () => {
    process.env.WEAVER_EVAL_CLEAN = "0";
    expect(isCleanMode()).toBe(false);

    process.env.WEAVER_EVAL_CLEAN = "true";
    expect(isCleanMode()).toBe(false);

    process.env.WEAVER_EVAL_CLEAN = "";
    expect(isCleanMode()).toBe(false);
  });
});

describe("isHostClutterMode", () => {
  it("is off when unset, so a run defaults to the generic tool-use policy", () => {
    expect(isHostClutterMode()).toBe(false);
  });

  it("returns true only for the exact opt-in value", () => {
    process.env.WEAVER_EVAL_HOST_CLUTTER = "1";
    expect(isHostClutterMode()).toBe(true);

    process.env.WEAVER_EVAL_HOST_CLUTTER = "true";
    expect(isHostClutterMode()).toBe(false);

    process.env.WEAVER_EVAL_HOST_CLUTTER = "";
    expect(isHostClutterMode()).toBe(false);
  });
});

describe("formatRunHeader", () => {
  it("includes the model, trial count, and default temperature and clean-mode", () => {
    process.env.WEAVER_EVAL_MODEL = "anthropic/claude-haiku-4.5";
    expect(formatRunHeader(3)).toBe(
      "eval run — model anthropic/claude-haiku-4.5 | trials 3 | temperature default | clean-mode off | clutter generic",
    );
  });

  it("reports a set temperature, clean-mode, and host clutter", () => {
    process.env.WEAVER_EVAL_MODEL = "google/gemini-2.5-flash";
    process.env.WEAVER_EVAL_TEMPERATURE = "0";
    process.env.WEAVER_EVAL_CLEAN = "1";
    process.env.WEAVER_EVAL_HOST_CLUTTER = "1";
    expect(formatRunHeader(10)).toBe(
      "eval run — model google/gemini-2.5-flash | trials 10 | temperature 0 | clean-mode on | clutter host",
    );
  });
});
