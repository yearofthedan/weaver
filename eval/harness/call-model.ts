import { type ModelConfig, modelConfig } from "./config.js";

const MAX_TOKENS = 4096;
// Well under the lane's 120s testTimeout so a hung server surfaces as a clear
// fetch timeout instead of an opaque vitest timeout.
const REQUEST_TIMEOUT_MS = 60_000;
// A transient network abort is retried once (2 attempts): the hang usually
// clears immediately, so one retry recovers the call within the case budget
// instead of discarding the whole case. A persistent timeout still propagates.
const MAX_TIMEOUT_ATTEMPTS = 2;
// An empty completion returns fast, so a provider hiccup can be retried more
// before it is surfaced as a fault (see isEmptyWithTools).
const MAX_EMPTY_ATTEMPTS = 3;

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

/** A fetch aborted by {@link REQUEST_TIMEOUT_MS} rejects with a TimeoutError. */
function isTransientTimeout(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: unknown }).name === "TimeoutError"
  );
}

/**
 * True when the model returned nothing usable — no tool call and no text —
 * while tools were on offer. A real "I won't use a tool" answer carries text,
 * so an empty message here is a provider fault (some OpenRouter backends drop
 * the tool-call generation and return an empty completion), not a model choice.
 * Left silent, the agentic loop would score it as a skill-text loss.
 */
function isEmptyWithTools(response: ModelResponse, tools: ToolDefinition[]): boolean {
  return tools.length > 0 && response.toolCalls.length === 0 && response.text === "";
}

/** One chat-completion round-trip: fetch, check status, parse the choice. */
async function sendOnce(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  config: ModelConfig,
): Promise<ModelResponse> {
  const { baseUrl, model, apiKey, temperature, provider } = config;

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
      // OpenRouter routing: pin to one backend with fallbacks off so the rate
      // is reproducible. Omitted entirely when unset (non-OpenRouter endpoints
      // ignore it, but there is no reason to send it).
      ...(provider ? { provider: { order: [provider], allow_fallbacks: false } } : {}),
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

/**
 * Sends a chat completion request to an OpenAI-compatible model server, retrying
 * two classes of transient provider fault so they do not masquerade as a
 * skill-text signal in the rate lane:
 *
 * - a network timeout is retried once ({@link MAX_TIMEOUT_ATTEMPTS});
 * - an empty completion returned while tools were offered is retried
 *   ({@link MAX_EMPTY_ATTEMPTS}) and then thrown as a named provider fault
 *   rather than returned as a scored-zero trial.
 *
 * A real HTTP/server error (non-2xx, no choices) still throws immediately.
 * max_tokens is generous to accommodate thinking-mode models that emit reasoning
 * tokens before the tool call. The target server comes from the injected config
 * (WEAVER_EVAL_BASE_URL / WEAVER_EVAL_MODEL / WEAVER_EVAL_API_KEY /
 * WEAVER_EVAL_TEMPERATURE); pass a config explicitly to override, e.g. to pin
 * temperature 0 for deterministic lanes.
 */
export async function callModel(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  config: ModelConfig = modelConfig(),
): Promise<ModelResponse> {
  for (let attempt = 1; ; attempt++) {
    let response: ModelResponse;
    try {
      response = await sendOnce(messages, tools, config);
    } catch (err) {
      if (isTransientTimeout(err) && attempt < MAX_TIMEOUT_ATTEMPTS) continue;
      throw err;
    }

    if (isEmptyWithTools(response, tools)) {
      if (attempt < MAX_EMPTY_ATTEMPTS) continue;
      throw new Error(
        `Model server returned an empty completion (no tool call, no content) ${MAX_EMPTY_ATTEMPTS}× ` +
          `while ${tools.length} tool(s) were offered — the provider is likely dropping the tool-call ` +
          `generation. Check WEAVER_EVAL_PROVIDER; pin a provider that emits tool calls for this model.`,
      );
    }

    return response;
  }
}
