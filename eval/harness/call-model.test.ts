import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callModel } from "./call-model.js";

const BASE_URL = "http://localhost:11434/v1";
const MODEL = "qwen3:14b";

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WEAVER_EVAL_BASE_URL;
  delete process.env.WEAVER_EVAL_MODEL;
});

function makeCompletionResponse(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
  text = "",
) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: text || null,
          tool_calls: toolCalls.map((tc, i) => ({
            id: `call_${i}`,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        },
      },
    ],
  };
}

function makeTextResponse(text: string) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: text,
          tool_calls: null,
        },
      },
    ],
  };
}

describe("callModel", () => {
  describe("request shape", () => {
    it("posts to the chat completions endpoint with temperature 0 and generous max_tokens", async () => {
      const messages = [{ role: "user" as const, content: "hello" }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("hi"),
      });

      await callModel(messages, []);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/chat/completions`);
      const body = JSON.parse(init.body as string);
      expect(body.temperature).toBe(0);
      expect(body.max_tokens).toBeGreaterThanOrEqual(4096);
      expect(body.model).toBe(MODEL);
      expect(body.messages).toEqual(messages);
    });

    it("sends an abort signal so a hung server cannot block until the test timeout", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("hi"),
      });

      await callModel([{ role: "user", content: "hello" }], []);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("includes tools in the request when provided", async () => {
      const tools = [
        {
          type: "function" as const,
          function: { name: "my_tool", description: "does a thing", parameters: {} },
        },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("ok"),
      });

      await callModel([{ role: "user", content: "go" }], tools);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.tools).toEqual(tools);
    });

    it("uses WEAVER_EVAL_BASE_URL when set", async () => {
      process.env.WEAVER_EVAL_BASE_URL = "http://custom-server:8080/v1";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("hi"),
      });

      await callModel([{ role: "user", content: "test" }], []);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://custom-server:8080/v1/chat/completions");
    });

    it("uses WEAVER_EVAL_MODEL when set", async () => {
      process.env.WEAVER_EVAL_MODEL = "llama3:8b";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("hi"),
      });

      await callModel([{ role: "user", content: "test" }], []);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("llama3:8b");
    });
  });

  describe("response parsing", () => {
    it("returns tool calls with parsed arguments from the assistant message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeCompletionResponse([{ name: "weaver_rename", arguments: { newName: "bar" } }]),
      });

      const result = await callModel([{ role: "user", content: "rename foo to bar" }], []);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe("weaver_rename");
      expect(result.toolCalls[0].arguments).toEqual({ newName: "bar" });
    });

    it("returns multiple tool calls when the model emits more than one", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeCompletionResponse([
            { name: "tool_a", arguments: { x: 1 } },
            { name: "tool_b", arguments: { y: 2 } },
          ]),
      });

      const result = await callModel([{ role: "user", content: "multi" }], []);

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe("tool_a");
      expect(result.toolCalls[1].name).toBe("tool_b");
    });

    it("returns empty toolCalls and the text content when no tool is called", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("I cannot help with that."),
      });

      const result = await callModel([{ role: "user", content: "explain everything" }], []);

      expect(result.toolCalls).toEqual([]);
      expect(result.text).toBe("I cannot help with that.");
    });

    it("returns empty text when the message content is null", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeCompletionResponse([{ name: "do_thing", arguments: {} }], ""),
      });

      const result = await callModel([{ role: "user", content: "go" }], []);

      expect(result.text).toBe("");
    });
  });

  describe("error handling", () => {
    it("throws with the response body when the server returns a non-ok status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => '{"error":"model not found"}',
      });

      await expect(callModel([{ role: "user", content: "hi" }], [])).rejects.toThrow(
        '{"error":"model not found"}',
      );
    });

    it("includes the HTTP status code in the error message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "not found",
      });

      await expect(callModel([{ role: "user", content: "hi" }], [])).rejects.toThrow("404");
    });

    it("throws a descriptive error when the server returns no choices", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [] }),
      });

      await expect(callModel([{ role: "user", content: "hi" }], [])).rejects.toThrow("no choices");
    });

    it("propagates network errors without retrying", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

      await expect(callModel([{ role: "user", content: "hi" }], [])).rejects.toThrow(
        "fetch failed",
      );

      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });
});
