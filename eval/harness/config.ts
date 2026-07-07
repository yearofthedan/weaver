const DEFAULT_TEMPERATURE = 0.7;

export interface ModelConfig {
  baseUrl: string;
  model: string;
  /** Bearer token for hosted model endpoints. Leave unset for local Ollama (no auth). */
  apiKey?: string;
  /**
   * Sampling temperature sent to the model. Defaults to 0.7 (WEAVER_EVAL_TEMPERATURE).
   * Command and two-step lanes pass 0 explicitly to stay deterministic.
   */
  temperature: number;
}

export function modelConfig(): ModelConfig {
  return {
    baseUrl: process.env.WEAVER_EVAL_BASE_URL ?? "",
    model: process.env.WEAVER_EVAL_MODEL ?? "",
    // Intentionally undefined when unset so callModel's "no header" branch keys off absence.
    apiKey: process.env.WEAVER_EVAL_API_KEY,
    temperature:
      process.env.WEAVER_EVAL_TEMPERATURE !== undefined
        ? Number(process.env.WEAVER_EVAL_TEMPERATURE)
        : DEFAULT_TEMPERATURE,
  };
}
