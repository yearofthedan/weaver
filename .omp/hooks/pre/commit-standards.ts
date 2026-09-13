// OMP side of the communication-standards commit gate.
//
// The review itself is scripts/commit-standards-review.sh, which both harnesses
// share. Claude Code runs it directly as a PreToolUse(Bash) command hook; OMP
// loads in-process modules instead, so this translates between the two: an OMP
// `tool_call` event becomes the stdin JSON the script reads, and the script's
// deny response becomes OMP's block contract.
//
// The reviewer is OMP itself. The script requires COMMIT_REVIEW_CMD and has no
// default precisely so neither harness ends up invoking the other's CLI.
//
// The script owns what counts as a commit, whether anything is staged, and the
// repeat-attempt override. The filter here is deliberately wider than that rule
// so it never decides on the script's behalf — it exists only to avoid spawning
// a subprocess on unrelated bash calls.

import { execFile } from "node:child_process";

const SCRIPT = "scripts/commit-standards-review.sh";
const REVIEWER = "omp -p --model deepseek/deepseek-v4.1-flash --no-tools --no-session";

interface ToolCallEvent {
  toolName: string;
  input: Record<string, unknown>;
}

interface HookApi {
  on(
    event: "tool_call",
    handler: (event: ToolCallEvent) => Promise<{ block: true; reason: string } | undefined>,
  ): void;
}

interface ReviewDecision {
  hookSpecificOutput?: {
    permissionDecision?: string;
    permissionDecisionReason?: string;
  };
}

function review(repo: string, command: string): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  const child = execFile(
    "bash",
    [SCRIPT],
    { cwd: repo, env: { ...process.env, CLAUDE_PROJECT_DIR: repo, COMMIT_REVIEW_CMD: REVIEWER } },
    // A reviewer outage is the script's own fail-open case, and a script that
    // cannot run at all must not wedge every commit, so both resolve empty.
    (_error, stdout) => resolve(stdout ?? ""),
  );
  child.stdin?.end(JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
  return promise;
}

export default function commitStandards(pi: HookApi): void {
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return;

    const command = String(event.input.command ?? "");
    if (!command.includes("commit")) return;

    const stdout = (await review(process.cwd(), command)).trim();
    if (!stdout) return;

    let decision: ReviewDecision;
    try {
      decision = JSON.parse(stdout);
    } catch {
      return;
    }

    const outcome = decision.hookSpecificOutput;
    if (outcome?.permissionDecision !== "deny") return;

    return {
      block: true,
      reason: outcome.permissionDecisionReason ?? "Communication-standards review found problems.",
    };
  });
}
