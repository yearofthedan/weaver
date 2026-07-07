import { type ModelConfig, modelConfig } from "./config.js";

const MAX_TOKENS = 4096;
// Well under the lane's 120s testTimeout so a hung server surfaces as a clear
// fetch timeout instead of an opaque vitest timeout.
const REQUEST_TIMEOUT_MS = 60_000;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
  /**
   * The raw arguments string when the model emitted malformed JSON (in which
   * case `arguments` is empty). A host feeds an error back for such a call
   * rather than crashing — the loop does the same.
   */
  invalidArguments?: string;
}

export interface ModelResponse {
  toolCalls: ToolCall[];
  text: string;
}

// The wire format wants tool calls as {id, type, function: {name, arguments}}
// with arguments as a JSON *string*; the harness's ToolCall keeps them as an
// object. Seeded assistant messages must be converted or the server rejects
// the request.
function toWireMessage(message: ChatMessage): Record<string, unknown> {
  if (!message.tool_calls) {
    return { ...message };
  }
  return {
    ...message,
    tool_calls: message.tool_calls.map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      type: "function",
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    })),
  };
}

/**
 * Sends a single chat completion request to an OpenAI-compatible model server.
 * max_tokens is generous to accommodate thinking-mode models that emit reasoning
 * tokens before the tool call.
 *
 * The target server comes from the injected config (WEAVER_EVAL_BASE_URL /
 * WEAVER_EVAL_MODEL / WEAVER_EVAL_API_KEY / WEAVER_EVAL_TEMPERATURE); pass a
 * config explicitly to override, e.g. to pin temperature 0 for deterministic lanes.
 *
 * HTTP/server errors throw immediately with the response body — no retries.
 */
export async function callModel(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  config: ModelConfig = modelConfig(),
): Promise<ModelResponse> {
  const { baseUrl, model, apiKey, temperature } = config;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: messages.map(toWireMessage),
      tools: tools.length > 0 ? tools : undefined,
      temperature,
      max_tokens: MAX_TOKENS,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Model server returned ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices: Array<{
      message: {
        content: string | null;
        tool_calls?: Array<{
          id?: string;
          type: string;
          function: { name: string; arguments: string };
        }> | null;
      };
    }>;
  };

  const message = data.choices[0]?.message;
  if (!message) {
    throw new Error(`Model server returned no choices: ${JSON.stringify(data)}`);
  }

  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((tc) => {
    try {
      return {
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      };
    } catch {
      return {
        id: tc.id,
        name: tc.function.name,
        arguments: {},
        invalidArguments: tc.function.arguments,
      };
    }
  });

  return {
    toolCalls,
    text: message.content ?? "",
  };
}
