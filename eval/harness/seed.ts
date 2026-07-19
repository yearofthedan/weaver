import type { ChatMessage } from "./call-model.js";

interface TrueShellStep {
  userRequest: string;
  assistantIntent: string;
  command: string;
  toolOutput: string;
  assistantSummary: string;
}

/**
 * The true-shell pre-step pool for {@link buildHabitMomentumSeed}. Each entry
 * is work weaver has no operation for — log inspection, git history search,
 * filename search — so seeding it primes a general shell-tool habit rather
 * than a substitution precedent for a real weaver op (the momentum-seed
 * principle in docs/eval-design.md).
 */
const TRUE_SHELL_POOL: TrueShellStep[] = [
  {
    userRequest: "Check the build log for any error lines.",
    assistantIntent: "I'll grep the build log for ERROR lines.",
    command: 'grep -n "ERROR" /tmp/weaver-eval/build.log',
    toolOutput: "/tmp/weaver-eval/build.log:42:ERROR: connection timed out after 30s",
    assistantSummary: "Found one ERROR line: a connection timeout at line 42.",
  },
  {
    userRequest: "Has anyone touched the auth module recently? Check the commit history.",
    assistantIntent: "I'll search the git log for commits mentioning auth.",
    command: 'git log --grep="auth" --oneline -5',
    toolOutput:
      "a1b2c3d fix(auth): handle expired session tokens\ne4f5g6h feat(auth): add refresh flow",
    assistantSummary:
      "Found two recent commits touching auth: a session-token fix and a refresh-flow feature.",
  },
  {
    userRequest: "Are there any test files for the parser?",
    assistantIntent: "I'll find files matching the parser test naming pattern.",
    command: 'find /tmp/weaver-eval -name "*parser*.test.ts"',
    toolOutput:
      "/tmp/weaver-eval/src/parser/parser.test.ts\n/tmp/weaver-eval/src/parser/tokenizer.test.ts",
    assistantSummary: "Found two parser-related test files: parser.test.ts and tokenizer.test.ts.",
  },
];

/**
 * Builds a habit-momentum seed conversation for the trigger lane. The seed
 * prepends `turns` distinct true-shell pre-step exchanges before the real
 * task, so the model has momentum toward shell tools rather than skills.
 * Each pre-step is a standard tool-use exchange (matching how the agentic
 * loop replays live turns):
 *   1. User: an unrelated shell-appropriate request
 *   2. Assistant: a `bash` tool call for a true-shell step
 *   3. Tool: the canned output
 *   4. Assistant: a short summary of the result
 *
 * followed by the real trigger task as the final user turn. `turns` selects
 * the first `turns` entries of {@link TRUE_SHELL_POOL} in order; `turns = 0`
 * seeds nothing. A request beyond the pool size throws rather than cycling
 * or silently under-seeding — a typo in a case's `momentumTurns` must fail
 * loud, not quietly weaken the pressure ladder.
 */
export function buildHabitMomentumSeed(task: string, turns = 1): ChatMessage[] {
  if (turns > TRUE_SHELL_POOL.length) {
    throw new Error(
      `buildHabitMomentumSeed: requested ${turns} turns but the true-shell pool only has ${TRUE_SHELL_POOL.length}`,
    );
  }

  const preSteps = TRUE_SHELL_POOL.slice(0, turns).flatMap((step, index) => {
    const callId = `seed-shell-${index}`;
    return [
      { role: "user", content: step.userRequest },
      {
        role: "assistant",
        content: step.assistantIntent,
        tool_calls: [{ id: callId, name: "bash", arguments: { command: step.command } }],
      },
      { role: "tool", tool_call_id: callId, content: step.toolOutput },
      { role: "assistant", content: step.assistantSummary },
    ] as ChatMessage[];
  });

  return [...preSteps, { role: "user", content: task }];
}

/**
 * Builds the pre-seeded message array for a two-step eval case, as a real
 * tool exchange (mirroring {@link buildHabitMomentumSeed}):
 *
 *   1. User: the original task
 *   2. Assistant: a `bash` tool call running the step-1 weaver command
 *   3. Tool: the command's output (the canned fixture JSON, embedded verbatim)
 *
 * The follow-up call is left for the model to make in response — this only
 * builds the seed, not the request.
 */
export function buildSeedMessages(
  task: string,
  step1Command: string,
  fixtureContent: string,
): ChatMessage[] {
  const step1CallId = "seed-step1";
  return [
    {
      role: "user",
      content: task,
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: step1CallId, name: "bash", arguments: { command: step1Command } }],
    },
    {
      role: "tool",
      tool_call_id: step1CallId,
      content: fixtureContent,
    },
  ];
}
