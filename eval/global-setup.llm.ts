/**
 * globalSetup for the LLM eval lane.
 *
 * Asserts that the hosted model endpoint is explicitly configured AND that the
 * configured provider actually emits tool calls before any case runs, so the
 * failure is immediately actionable rather than manifesting as individual test
 * timeouts, confusing connection errors, or a whole run of silent zeros (some
 * OpenRouter backends return empty completions when tools are present — see
 * docs/eval-design.md).
 *
 * Required env vars:
 *   WEAVER_EVAL_BASE_URL  — base URL of an OpenAI-compatible endpoint
 *   WEAVER_EVAL_MODEL     — model identifier to use
 *   WEAVER_EVAL_API_KEY   — API key for the endpoint
 *
 * Example (OpenRouter):
 *   WEAVER_EVAL_BASE_URL=https://openrouter.ai/api/v1
 *   WEAVER_EVAL_MODEL=meta-llama/llama-3.3-70b-instruct
 *   WEAVER_EVAL_API_KEY=<your key>
 */

import { callModel, type ToolDefinition } from "./harness/call-model.js";
import { type ModelConfig, modelConfig } from "./harness/config.js";

/**
 * Returns true when all three required hosted-endpoint env vars are set to a
 * non-empty value. Pure function — no side effects, safe to call in tests.
 */
export function isHostedEndpointConfigured(): boolean {
  return Boolean(
    process.env.WEAVER_EVAL_BASE_URL &&
      process.env.WEAVER_EVAL_MODEL &&
      process.env.WEAVER_EVAL_API_KEY,
  );
}

/** A trivial tool whose only job is to check the provider will emit a tool call. */
const PROBE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "ping",
    description: "Acknowledge you can call a tool.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

/**
 * Sends one tool-carrying request to the configured provider. Returns nothing on
 * success; `callModel` throws a named provider fault if the provider returns
 * empty completions (dropping the tool-call generation), which surfaces the
 * broken pin in seconds instead of after a multi-minute run of silent zeros.
 */
export async function probeToolCalling(config: ModelConfig = modelConfig()): Promise<void> {
  await callModel(
    [{ role: "user", content: "Call the ping tool to confirm tool calling works." }],
    [PROBE_TOOL],
    config,
  );
}

export default async function globalSetup(): Promise<void> {
  if (!isHostedEndpointConfigured()) {
    throw new Error(
      "Hosted model endpoint not configured. Set all three env vars before running evals:\n" +
        "\n" +
        "  WEAVER_EVAL_BASE_URL=https://openrouter.ai/api/v1\n" +
        "  WEAVER_EVAL_MODEL=meta-llama/llama-3.3-70b-instruct\n" +
        "  WEAVER_EVAL_API_KEY=<your OpenRouter key>\n" +
        "\n" +
        "Missing: " +
        [
          !process.env.WEAVER_EVAL_BASE_URL && "WEAVER_EVAL_BASE_URL",
          !process.env.WEAVER_EVAL_MODEL && "WEAVER_EVAL_MODEL",
          !process.env.WEAVER_EVAL_API_KEY && "WEAVER_EVAL_API_KEY",
        ]
          .filter(Boolean)
          .join(", "),
    );
  }

  await probeToolCalling();
}
