/**
 * globalSetup for the LLM eval lane.
 *
 * Probes the model server before any case runs. If the server is unreachable
 * or the configured model is not listed, it throws an actionable error naming
 * the base URL and the ollama pull command — so the failure is immediately
 * actionable rather than manifesting as 15+ individual test timeouts.
 */

import { modelConfig } from "./harness/config.js";

export default async function globalSetup(): Promise<void> {
  const { baseUrl, model, apiKey } = modelConfig();

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let models: string[];
  try {
    const response = await fetch(`${baseUrl}/models`, { headers });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Server responded with ${response.status}: ${body}`);
    }
    const data = (await response.json()) as { data?: Array<{ id: string }> };
    models = (data.data ?? []).map((m) => m.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot reach model server at ${baseUrl} — ${message}\n` +
        `Start the server and ensure the model is available:\n` +
        `  ollama pull ${model}`,
    );
  }

  if (!models.includes(model)) {
    throw new Error(
      `Model "${model}" is not available at ${baseUrl}.\n` +
        `Available models: ${models.length > 0 ? models.join(", ") : "(none)"}\n` +
        `Run: ollama pull ${model}`,
    );
  }
}
