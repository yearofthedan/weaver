import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import globalSetup from "./global-setup.llm.js";

let mockFetch: ReturnType<typeof vi.fn>;

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

const BASE_URL = "http://localhost:11434/v1";
const MODEL = "qwen2.5:7b-instruct";

function makeModelsResponse(modelIds: string[]) {
  return {
    ok: true,
    json: async () => ({ data: modelIds.map((id) => ({ id })) }),
  };
}

describe("globalSetup probe", () => {
  describe("auth header forwarding", () => {
    it("sends Authorization header when WEAVER_EVAL_API_KEY is set", async () => {
      process.env.WEAVER_EVAL_API_KEY = "sk-test-key";
      mockFetch.mockResolvedValueOnce(makeModelsResponse([MODEL]));

      await globalSetup();

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-test-key");
    });

    it("omits Authorization header when WEAVER_EVAL_API_KEY is not set", async () => {
      mockFetch.mockResolvedValueOnce(makeModelsResponse([MODEL]));

      await globalSetup();

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });
  });

  describe("error messages", () => {
    it("does not include the api key value in the error when the server is unreachable", async () => {
      const secretKey = "sk-very-secret-probe-key";
      process.env.WEAVER_EVAL_API_KEY = secretKey;
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

      await expect(globalSetup()).rejects.toSatisfy((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return !message.includes(secretKey);
      });
    });

    it("does not include the api key value in the error when the server returns an HTTP error", async () => {
      const secretKey = "sk-very-secret-probe-key";
      process.env.WEAVER_EVAL_API_KEY = secretKey;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      });

      await expect(globalSetup()).rejects.toSatisfy((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return !message.includes(secretKey);
      });
    });

    it("names the base URL and pull command in the unreachable error", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("connection refused"));

      await expect(globalSetup()).rejects.toThrow(
        new RegExp(`${BASE_URL}.*ollama pull ${MODEL}`, "s"),
      );
    });

    it("names the available models and the missing model when the configured model is absent", async () => {
      mockFetch.mockResolvedValueOnce(makeModelsResponse(["llama3:8b", "mistral:7b"]));

      await expect(globalSetup()).rejects.toThrow(/llama3:8b.*mistral:7b/);
    });
  });

  describe("success path", () => {
    it("resolves without error when the configured model is available", async () => {
      mockFetch.mockResolvedValueOnce(makeModelsResponse([MODEL, "llama3:8b"]));

      await expect(globalSetup()).resolves.toBeUndefined();
    });
  });
});
