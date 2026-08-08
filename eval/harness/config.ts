/** One model the gate runs the suite against, and the trial count it runs at before escalation. */
export interface GatingModel {
  /** OpenRouter model id, sent as WEAVER_EVAL_MODEL. */
  id: string;
  baseTrials: number;
}

/**
 * The models the gate requires a clean run from, and the only place that
 * list is written — the runner and marker validation both read this rather
 * than each keeping their own copy. Unlike {@link modelConfig}, which reads
 * the model for *this* run from the environment, this is a fixed roster of
 * every model a run can target.
 */
export const GATING_MODELS: readonly GatingModel[] = [
  { id: "anthropic/claude-haiku-4.5", baseTrials: 3 },
  { id: "google/gemini-2.5-flash", baseTrials: 10 },
  { id: "openai/gpt-5.6-luna", baseTrials: 10 },
];

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

// Printed once at the top of a run so a mislabelled model or knob is visible
// in the output itself rather than silently determining what the rates mean.
export function formatRunHeader(baseTrialCount: number): string {
  const { model, temperature } = modelConfig();
  return (
    `eval run — model ${model} | trials ${baseTrialCount} | ` +
    `temperature ${temperature ?? "default"} | clean-mode ${isCleanMode() ? "on" : "off"}`
  );
}
