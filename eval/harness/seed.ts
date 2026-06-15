import type { ChatMessage } from "./call-model.js";

/**
 * Builds a habit-momentum seed conversation for the adversarial trigger lane.
 * The seed primes the model with a successful grep interaction before the real
 * task arrives, so the model has momentum toward shell tools rather than skills.
 *
 * Four plain-text turns (no tool_call/tool messages — Ollama drops seeded tool
 * calls silently, mirroring the approach in buildSeedMessages):
 *   1. User: an unrelated search request
 *   2. Assistant: a response that uses grep -rn successfully
 *   3. User: canned grep output
 *   4. User: the real trigger task, verbatim
 */
export function buildHabitMomentumSeed(task: string): ChatMessage[] {
  return [
    {
      role: "user",
      content: "Find all files that import the Logger class in the src/ directory.",
    },
    {
      role: "assistant",
      content:
        "I'll search for Logger imports using grep:\n\n" +
        '```\ngrep -rn "import.*Logger" src/\n```\n\n' +
        "```\nsrc/daemon/daemon.ts:3:import { Logger } from '../utils/logger.js';\n" +
        "src/adapters/cli/cli.ts:5:import { Logger } from '../utils/logger.js';\n" +
        "src/operations/rename.ts:2:import { Logger } from '../utils/logger.js';\n" +
        "```\n\n" +
        "Found 3 files that import Logger: daemon.ts, cli.ts, and rename.ts.",
    },
    {
      role: "user",
      content:
        "Thanks! That's exactly what I needed.\n\n" +
        "```\nsrc/daemon/daemon.ts:3:import { Logger } from '../utils/logger.js';\n" +
        "src/adapters/cli/cli.ts:5:import { Logger } from '../utils/logger.js';\n" +
        "src/operations/rename.ts:2:import { Logger } from '../utils/logger.js';\n" +
        "```",
    },
    {
      role: "user",
      content: task,
    },
  ];
}

/**
 * Builds the pre-seeded message array for a two-step eval case, as plain
 * conversation turns:
 *
 *   1. User: the original task
 *   2. Assistant: the step-1 weaver command it "ran"
 *   3. User: the command's output (the canned fixture JSON, embedded verbatim)
 *      plus a prompt for the follow-up command
 *
 * Text turns rather than tool_call/tool messages: local-model servers parse
 * tool calls unreliably (Ollama silently drops calls it cannot parse), and the
 * assertion target is the command string either way.
 */
export function buildSeedMessages(
  task: string,
  step1Command: string,
  fixtureContent: string,
): ChatMessage[] {
  return [
    {
      role: "user",
      content: task,
    },
    {
      role: "assistant",
      content: step1Command,
    },
    {
      role: "user",
      content: `Output of \`${step1Command}\`:\n${fixtureContent}\n\nReply with ONLY the single shell command to run next. No explanation, no markdown.`,
    },
  ];
}
