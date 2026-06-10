const DEFAULT_BASE_URL = "http://localhost:11434/v1";
// qwen2.5 rather than qwen3: thinking-mode lineages stall on tool/command
// emission under Ollama (see docs/eval-design.md gotchas).
const DEFAULT_MODEL = "qwen2.5:7b-instruct";

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
