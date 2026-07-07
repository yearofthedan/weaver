import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callModel } from "./call-model.js";

const TEST_BASE_URL = "http://test-server/v1";
const TEST_MODEL = "test-model";

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
  delete process.env.WEAVER_EVAL_TEMPERATURE;
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

function explicitConfig(overrides: { temperature?: number; apiKey?: string } = {}) {
  return {
    baseUrl: TEST_BASE_URL,
    model: TEST_MODEL,
    temperature: 0.7,
    ...overrides,
  };
}

describe("callModel", () => {
  describe("request shape", () => {
    it("posts to the chat completions endpoint with generous max_tokens", async () => {
      const messages = [{ role: "user" as const, content: "hello" }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("hi"),
      });

      await callModel(messages, [], explicitConfig());

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${TEST_BASE_URL}/chat/completions`);
      const body = JSON.parse(init.body as string);
      expect(body.max_tokens).toBeGreaterThanOrEqual(4096);
      expect(body.model).toBe(TEST_MODEL);
      expect(body.messages).toEqual(messages);
    });

    it("sends the configured temperature — not a hardcoded value", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("hi"),
      });

      await callModel([{ role: "user", content: "hi" }], [], explicitConfig({ temperature: 0.7 }));

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.temperature).toBe(0.7);
      expect(body.temperature).not.toBe(0);
    });

    it("sends temperature 0 when explicitly overridden to 0", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("hi"),
      });

      await callModel([{ role: "user", content: "hi" }], [], explicitConfig({ temperature: 0 }));

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.temperature).toBe(0);
    });

    it("serializes assistant tool_calls to the wire format with stringified arguments", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("ok"),
      });

      await callModel(
        [
          { role: "user", content: "task" },
          {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "step1", name: "bash", arguments: { command: "weaver x '{}'" } }],
          },
          { role: "tool", content: '{"status":"success"}', tool_call_id: "step1" },
        ],
        [],
        explicitConfig(),
      );

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.messages[1].tool_calls).toEqual([
        {
          id: "step1",
          type: "function",
          function: { name: "bash", arguments: '{"command":"weaver x \'{}\'"}' },
        },
      ]);
      expect(body.messages[2]).toEqual({
        role: "tool",
        content: '{"status":"success"}',
        tool_call_id: "step1",
      });
    });

    it("sends an abort signal so a hung server cannot block until the test timeout", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("hi"),
      });

      await callModel([{ role: "user", content: "hello" }], [], explicitConfig());

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

      await callModel([{ role: "user", content: "go" }], tools, explicitConfig());

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.tools).toEqual(tools);
    });

    it("uses WEAVER_EVAL_BASE_URL and WEAVER_EVAL_MODEL when set", async () => {
      process.env.WEAVER_EVAL_BASE_URL = "http://custom-server:8080/v1";
      process.env.WEAVER_EVAL_MODEL = "llama3:8b";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("hi"),
      });

      await callModel([{ role: "user", content: "test" }], []);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://custom-server:8080/v1/chat/completions");
      expect(JSON.parse(init.body as string).model).toBe("llama3:8b");
    });

    it("sends Authorization header when apiKey is set in config", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("hi"),
      });

      await callModel(
        [{ role: "user", content: "test" }],
        [],
        explicitConfig({ apiKey: "sk-test-secret-key" }),
      );

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-test-secret-key");
    });

    it("omits Authorization header when apiKey is not set", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("hi"),
      });

      await callModel([{ role: "user", content: "test" }], [], explicitConfig());

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it("picks up apiKey from WEAVER_EVAL_API_KEY env var", async () => {
      process.env.WEAVER_EVAL_API_KEY = "sk-env-secret";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("hi"),
      });

      await callModel([{ role: "user", content: "test" }], []);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-env-secret");
    });

    it("uses an explicitly passed config over the env-derived default", async () => {
      process.env.WEAVER_EVAL_MODEL = "env-model";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("hi"),
      });

      await callModel([{ role: "user", content: "test" }], [], {
        baseUrl: "http://injected:9999/v1",
        model: "injected-model",
        temperature: 0,
      });

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://injected:9999/v1/chat/completions");
      expect(JSON.parse(init.body as string).model).toBe("injected-model");
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

      const result = await callModel(
        [{ role: "user", content: "rename foo to bar" }],
        [],
        explicitConfig(),
      );

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

      const result = await callModel([{ role: "user", content: "multi" }], [], explicitConfig());

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].name).toBe("tool_a");
      expect(result.toolCalls[1].name).toBe("tool_b");
    });

    it("returns empty toolCalls and the text content when no tool is called", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeTextResponse("I cannot help with that."),
      });

      const result = await callModel(
        [{ role: "user", content: "explain everything" }],
        [],
        explicitConfig(),
      );

      expect(result.toolCalls).toEqual([]);
      expect(result.text).toBe("I cannot help with that.");
    });

    it("marks a tool call with malformed JSON arguments instead of throwing", async () => {
      const rawArguments = '{"pattern":"unterminated';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_0",
                    type: "function",
                    function: { name: "weaver-search-and-replace", arguments: rawArguments },
                  },
                ],
              },
            },
          ],
        }),
      });

      const result = await callModel([{ role: "user", content: "go" }], [], explicitConfig());

      expect(result.toolCalls).toEqual([
        {
          id: "call_0",
          name: "weaver-search-and-replace",
          arguments: {},
          invalidArguments: rawArguments,
        },
      ]);
    });

    it("leaves invalidArguments unset when arguments parse cleanly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeCompletionResponse([{ name: "bash", arguments: { command: "ls" } }]),
      });

      const result = await callModel([{ role: "user", content: "go" }], [], explicitConfig());

      expect(result.toolCalls[0].invalidArguments).toBeUndefined();
      expect(result.toolCalls[0].arguments).toEqual({ command: "ls" });
    });

    it("returns empty text when the message content is null", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeCompletionResponse([{ name: "do_thing", arguments: {} }], ""),
      });

      const result = await callModel([{ role: "user", content: "go" }], [], explicitConfig());

      expect(result.text).toBe("");
    });
  });

  describe("error handling", () => {
    it("throws with the status code and the response body on a non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => '{"error":"model not found"}',
      });

      await expect(
        callModel([{ role: "user", content: "hi" }], [], explicitConfig()),
      ).rejects.toThrow(/503.*model not found/);
    });

    it("does not include the apiKey value in the thrown error on HTTP failure", async () => {
      const secretKey = "sk-super-secret-value";
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '{"error":"unauthorized"}',
      });

      await expect(
        callModel([{ role: "user", content: "hi" }], [], explicitConfig({ apiKey: secretKey })),
      ).rejects.toSatisfy((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return !message.includes(secretKey);
      });
    });

    it("throws a descriptive error when the server returns no choices", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [] }),
      });

      await expect(
        callModel([{ role: "user", content: "hi" }], [], explicitConfig()),
      ).rejects.toThrow("no choices");
    });

    it("propagates network errors without retrying", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

      await expect(
        callModel([{ role: "user", content: "hi" }], [], explicitConfig()),
      ).rejects.toThrow("fetch failed");

      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });
});
