import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import globalSetup, { isHostedEndpointConfigured, probeToolCalling } from "./global-setup.llm.js";

let mockFetch: ReturnType<typeof vi.fn>;

/** A completion that carries a tool call — a working, tool-calling provider. */
function toolCallResponse() {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "c0", type: "function", function: { name: "ping", arguments: "{}" } },
            ],
          },
        },
      ],
    }),
  };
}

/** An empty completion — the fault a broken OpenRouter backend returns with tools. */
function emptyResponse() {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { role: "assistant", content: null, tool_calls: null } }],
    }),
  };
}

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WEAVER_EVAL_BASE_URL;
  delete process.env.WEAVER_EVAL_MODEL;
  delete process.env.WEAVER_EVAL_API_KEY;
});

describe("isHostedEndpointConfigured", () => {
  it("returns true when all three env vars are set", () => {
    process.env.WEAVER_EVAL_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.WEAVER_EVAL_MODEL = "meta-llama/llama-3.3-70b-instruct";
    process.env.WEAVER_EVAL_API_KEY = "sk-or-test";
    expect(isHostedEndpointConfigured()).toBe(true);
  });

  it("returns false when WEAVER_EVAL_BASE_URL is missing", () => {
    process.env.WEAVER_EVAL_MODEL = "meta-llama/llama-3.3-70b-instruct";
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
    process.env.WEAVER_EVAL_MODEL = "meta-llama/llama-3.3-70b-instruct";
    expect(isHostedEndpointConfigured()).toBe(false);
  });

  it("returns false when none of the env vars are set", () => {
    expect(isHostedEndpointConfigured()).toBe(false);
  });
});

describe("globalSetup", () => {
  describe("fail-fast when env vars are absent", () => {
    it("throws when WEAVER_EVAL_BASE_URL is not set", async () => {
      process.env.WEAVER_EVAL_MODEL = "meta-llama/llama-3.3-70b-instruct";
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
      process.env.WEAVER_EVAL_MODEL = "meta-llama/llama-3.3-70b-instruct";
      await expect(globalSetup()).rejects.toThrow(/WEAVER_EVAL_API_KEY/);
    });

    it("includes the OpenRouter example base URL in the error", async () => {
      await expect(globalSetup()).rejects.toThrow(/openrouter\.ai/);
    });

    it("includes an example model name in the error", async () => {
      await expect(globalSetup()).rejects.toThrow(/llama/);
    });

    it("does not include a hardcoded key value in the error", async () => {
      await expect(globalSetup()).rejects.toSatisfy((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return !message.match(/sk-[a-zA-Z0-9]{10,}/);
      });
    });
  });

  describe("success path", () => {
    it("resolves when env vars are set and the provider emits a tool call", async () => {
      process.env.WEAVER_EVAL_BASE_URL = "https://openrouter.ai/api/v1";
      process.env.WEAVER_EVAL_MODEL = "meta-llama/llama-3.3-70b-instruct";
      process.env.WEAVER_EVAL_API_KEY = "sk-or-v1-test";
      mockFetch.mockResolvedValue(toolCallResponse());
      await expect(globalSetup()).resolves.toBeUndefined();
    });

    it("fails fast when the configured provider returns empty completions to a tool probe", async () => {
      process.env.WEAVER_EVAL_BASE_URL = "https://openrouter.ai/api/v1";
      process.env.WEAVER_EVAL_MODEL = "meta-llama/llama-3.3-70b-instruct";
      process.env.WEAVER_EVAL_API_KEY = "sk-or-v1-test";
      mockFetch.mockResolvedValue(emptyResponse());
      await expect(globalSetup()).rejects.toThrow(/empty completion.*WEAVER_EVAL_PROVIDER/s);
    });

    it("does not probe the provider when env vars are missing", async () => {
      await expect(globalSetup()).rejects.toThrow(/not configured/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

describe("probeToolCalling", () => {
  const config = {
    baseUrl: "http://test/v1",
    model: "test-model",
    temperature: 0,
  };

  it("resolves when the provider returns a tool call", async () => {
    mockFetch.mockResolvedValue(toolCallResponse());
    await expect(probeToolCalling(config)).resolves.toBeUndefined();
  });

  it("sends a tool in the probe request so an empty-completion provider is caught", async () => {
    mockFetch.mockResolvedValue(toolCallResponse());
    await probeToolCalling(config);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe("ping");
  });

  it("rejects with a provider-fault message when the provider returns empty completions", async () => {
    mockFetch.mockResolvedValue(emptyResponse());
    await expect(probeToolCalling(config)).rejects.toThrow(/empty completion/);
  });
});
