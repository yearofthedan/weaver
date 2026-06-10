import { modelConfig } from "./config.js";

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
}

export interface ModelResponse {
  toolCalls: ToolCall[];
  text: string;
}

/**
 * Sends a single chat completion request to an OpenAI-compatible local model server.
 * Temperature is fixed at 0; max_tokens is generous to accommodate thinking-mode models
 * that emit reasoning tokens before the tool call.
 *
 * Base URL: WEAVER_EVAL_BASE_URL (default http://localhost:11434/v1)
 * Model:    WEAVER_EVAL_MODEL    (default qwen3:14b)
 *
 * HTTP/server errors throw immediately with the response body — no retries.
 */
export async function callModel(
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<ModelResponse> {
  const { baseUrl, model } = modelConfig();

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      temperature: 0,
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

  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
  }));

  return {
    toolCalls,
    text: message.content ?? "",
  };
}
