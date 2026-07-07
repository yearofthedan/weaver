import { afterEach, describe, expect, it } from "vitest";
import { modelConfig } from "./config.js";

afterEach(() => {
  delete process.env.WEAVER_EVAL_BASE_URL;
  delete process.env.WEAVER_EVAL_MODEL;
  delete process.env.WEAVER_EVAL_API_KEY;
  delete process.env.WEAVER_EVAL_TEMPERATURE;
});

describe("modelConfig", () => {
  describe("temperature", () => {
    it("returns 0.7 when WEAVER_EVAL_TEMPERATURE is not set", () => {
      const config = modelConfig();
      expect(config.temperature).toBe(0.7);
    });

    it("parses WEAVER_EVAL_TEMPERATURE as a number when set", () => {
      process.env.WEAVER_EVAL_TEMPERATURE = "0.3";
      const config = modelConfig();
      expect(config.temperature).toBe(0.3);
    });

    it("returns the exact env value — not the hardcoded default — when WEAVER_EVAL_TEMPERATURE is set", () => {
      process.env.WEAVER_EVAL_TEMPERATURE = "1.0";
      const config = modelConfig();
      expect(config.temperature).toBe(1.0);
      expect(config.temperature).not.toBe(0.7);
    });

    it("returns 0 when WEAVER_EVAL_TEMPERATURE is set to 0", () => {
      process.env.WEAVER_EVAL_TEMPERATURE = "0";
      const config = modelConfig();
      expect(config.temperature).toBe(0);
    });
  });

  describe("other fields", () => {
    it("returns all three model config fields", () => {
      process.env.WEAVER_EVAL_BASE_URL = "http://openrouter:8080/v1";
      process.env.WEAVER_EVAL_MODEL = "meta-llama/llama-3.3-70b-instruct";
      process.env.WEAVER_EVAL_API_KEY = "sk-or-test";
      const config = modelConfig();
      expect(config.baseUrl).toBe("http://openrouter:8080/v1");
      expect(config.model).toBe("meta-llama/llama-3.3-70b-instruct");
      expect(config.apiKey).toBe("sk-or-test");
    });
  });
});
