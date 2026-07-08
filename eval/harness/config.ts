const DEFAULT_TEMPERATURE = 0.7;

export interface ModelConfig {
  baseUrl: string;
  model: string;
  /** Bearer token for the hosted model endpoint. */
  apiKey?: string;
  /**
   * Sampling temperature sent to the model. Defaults to 0.7 (WEAVER_EVAL_TEMPERATURE).
   * Command and two-step lanes pass 0 explicitly to stay deterministic.
   */
  temperature: number;
  /**
   * OpenRouter provider to pin (WEAVER_EVAL_PROVIDER), e.g. "DeepInfra". When set,
   * every request is routed to that one backend with fallbacks disabled, so runs
   * are reproducible — OpenRouter otherwise load-balances a model across providers
   * whose quantization and tool-calling behaviour differ. Undefined = let OpenRouter route.
   */
  provider?: string;
}

// An unset or blank env var falls back to the default; a set-but-non-numeric
// value throws rather than silently sending NaN — or, for an empty string,
// Number("") === 0, which would quietly flip the rate lane to deterministic.
function parseTemperature(): number {
  const raw = process.env.WEAVER_EVAL_TEMPERATURE;
  if (raw === undefined || raw === "") {
    return DEFAULT_TEMPERATURE;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`WEAVER_EVAL_TEMPERATURE must be a finite number, got "${raw}"`);
  }
  return parsed;
}

export function modelConfig(): ModelConfig {
  return {
    baseUrl: process.env.WEAVER_EVAL_BASE_URL ?? "",
    model: process.env.WEAVER_EVAL_MODEL ?? "",
    // Intentionally undefined when unset so callModel's "no header" branch keys off absence.
    apiKey: process.env.WEAVER_EVAL_API_KEY,
    temperature: parseTemperature(),
    provider: process.env.WEAVER_EVAL_PROVIDER || undefined,
  };
}
