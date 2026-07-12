import { afterEach, describe, expect, it } from "vitest";
import globalSetup, { isHostedEndpointConfigured } from "./global-setup.llm.js";

afterEach(() => {
  delete process.env.WEAVER_EVAL_BASE_URL;
  delete process.env.WEAVER_EVAL_MODEL;
  delete process.env.WEAVER_EVAL_API_KEY;
});

describe("isHostedEndpointConfigured", () => {
  it("returns true when all three env vars are set", () => {
    process.env.WEAVER_EVAL_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.WEAVER_EVAL_MODEL = "anthropic/claude-haiku-4.5";
    process.env.WEAVER_EVAL_API_KEY = "sk-or-test";
    expect(isHostedEndpointConfigured()).toBe(true);
  });

  it("returns false when WEAVER_EVAL_BASE_URL is missing", () => {
    process.env.WEAVER_EVAL_MODEL = "anthropic/claude-haiku-4.5";
    process.env.WEAVER_EVAL_API_KEY = "sk-or-test";
    expect(isHostedEndpointConfigured()).toBe(false);
  });

  it("returns false when WEAVER_EVAL_MODEL is missing", () => {
    process.env.WEAVER_EVAL_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.WEAVER_EVAL_API_KEY = "sk-or-test";
    expect(isHostedEndpointConfigured()).toBe(false);
  });

  it("returns false when WEAVER_EVAL_API_KEY is missing", () => {
    process.env.WEAVER_EVAL_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.WEAVER_EVAL_MODEL = "anthropic/claude-haiku-4.5";
    expect(isHostedEndpointConfigured()).toBe(false);
  });

  it("returns false when none of the env vars are set", () => {
    expect(isHostedEndpointConfigured()).toBe(false);
  });
});

describe("globalSetup", () => {
  it("resolves when all three env vars are set", async () => {
    process.env.WEAVER_EVAL_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.WEAVER_EVAL_MODEL = "anthropic/claude-haiku-4.5";
    process.env.WEAVER_EVAL_API_KEY = "sk-or-v1-test";
    await expect(globalSetup()).resolves.toBeUndefined();
  });

  describe("fail-fast when env vars are absent", () => {
    it("throws when WEAVER_EVAL_BASE_URL is not set", async () => {
      process.env.WEAVER_EVAL_MODEL = "anthropic/claude-haiku-4.5";
      process.env.WEAVER_EVAL_API_KEY = "sk-or-test";
      await expect(globalSetup()).rejects.toThrow(/WEAVER_EVAL_BASE_URL/);
    });

    it("throws when WEAVER_EVAL_MODEL is not set", async () => {
      process.env.WEAVER_EVAL_BASE_URL = "https://openrouter.ai/api/v1";
      process.env.WEAVER_EVAL_API_KEY = "sk-or-test";
      await expect(globalSetup()).rejects.toThrow(/WEAVER_EVAL_MODEL/);
    });

    it("throws when WEAVER_EVAL_API_KEY is not set", async () => {
      process.env.WEAVER_EVAL_BASE_URL = "https://openrouter.ai/api/v1";
      process.env.WEAVER_EVAL_MODEL = "anthropic/claude-haiku-4.5";
      await expect(globalSetup()).rejects.toThrow(/WEAVER_EVAL_API_KEY/);
    });

    it("includes the OpenRouter example base URL in the error", async () => {
      await expect(globalSetup()).rejects.toThrow(/openrouter\.ai/);
    });

    it("includes an example model name in the error", async () => {
      await expect(globalSetup()).rejects.toThrow(/claude-haiku/);
    });

    it("does not include a hardcoded key value in the error", async () => {
      await expect(globalSetup()).rejects.toSatisfy((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return !message.match(/sk-[a-zA-Z0-9]{10,}/);
      });
    });
  });
});
