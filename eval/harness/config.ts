export interface ModelConfig {
  baseUrl: string;
  model: string;
  /** Bearer token for the hosted model endpoint. */
  apiKey?: string;
  /** Sampling temperature sent to the model (WEAVER_EVAL_TEMPERATURE). Absent by default, so the request omits the field and the model samples at its own default; set it (e.g. to 0) to pin a deterministic run. */
  temperature?: number;
}

// A set-but-non-numeric value throws rather than silently sending NaN — or,
// for an empty string, Number("") === 0, which would quietly pin the rate
// lane to deterministic sampling.
function parseTemperature(): number | undefined {
  const raw = process.env.WEAVER_EVAL_TEMPERATURE;
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`WEAVER_EVAL_TEMPERATURE must be a finite number, got "${raw}"`);
  }
  return parsed;
}

export function isCleanMode(): boolean {
  return process.env.WEAVER_EVAL_CLEAN === "1";
}

export function modelConfig(): ModelConfig {
  return {
    baseUrl: process.env.WEAVER_EVAL_BASE_URL ?? "",
    model: process.env.WEAVER_EVAL_MODEL ?? "",
    // Intentionally undefined when unset so callModel's "no header" branch keys off absence.
    apiKey: process.env.WEAVER_EVAL_API_KEY,
    temperature: parseTemperature(),
  };
}
