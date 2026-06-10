const DEFAULT_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_MODEL = "qwen3:8b";

export interface ModelConfig {
  baseUrl: string;
  model: string;
}

export function modelConfig(): ModelConfig {
  return {
    baseUrl: process.env.WEAVER_EVAL_BASE_URL ?? DEFAULT_BASE_URL,
    model: process.env.WEAVER_EVAL_MODEL ?? DEFAULT_MODEL,
  };
}
