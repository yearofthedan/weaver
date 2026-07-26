import { afterEach, describe, expect, it } from "vitest";
import { isCleanMode, modelConfig } from "./config.js";

afterEach(() => {
  delete process.env.WEAVER_EVAL_BASE_URL;
  delete process.env.WEAVER_EVAL_MODEL;
  delete process.env.WEAVER_EVAL_API_KEY;
  delete process.env.WEAVER_EVAL_TEMPERATURE;
  delete process.env.WEAVER_EVAL_CLEAN;
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
