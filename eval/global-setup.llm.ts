/**
 * globalSetup for the LLM eval lane.
 *
 * Asserts that the hosted model endpoint is explicitly configured before any
 * case runs, so the failure is immediately actionable rather than manifesting
 * as individual test timeouts or confusing connection errors.
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

export default async function globalSetup(): Promise<void> {
  if (isHostedEndpointConfigured()) {
    return;
  }

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
