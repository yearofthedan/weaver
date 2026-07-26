import type { ToolCall } from "./call-model.js";

/**
 * Key args whose value is a filesystem path. These are compared by trailing
 * path segment rather than exact string, because a model legitimately `cd`s
 * into the workspace and passes a workspace-relative path — `cd /ws && weaver
 * move-directory '{"oldPath":"src/x"}'` targets the same directory as the
 * absolute `/ws/src/x`. Non-path key args (`newName`, `pattern`, …) stay exact.
 */
const PATH_KEY_ARGS = new Set(["oldPath", "newPath", "file", "sourceFile", "destFile"]);

export type CommandOutcome = "correct" | "wrong-tool" | "wrong-args";

export interface WeaverCommandMatch {
  matched: boolean;
  /** `"correct"` iff matched; otherwise distinguishes reaching the right
   * subcommand with bad/missing args ("wrong-args") from never reaching it
   * ("wrong-tool"). */
  outcome: CommandOutcome;
  /** Populated when matched is false. */
  reason?: string;
}

/**
 * Returns true when the given bash command is a weaver invocation for the
 * given subcommand, tolerating any argument format (flags, quoted JSON, bare
 * strings). Accepts the `weaver`, `npx weaver`, and `pnpm exec weaver` prefix
 * forms. The word boundary prevents a prefix-matched subcommand (e.g. "renamed")
 * from satisfying the predicate for a shorter name (e.g. "rename").
 *
 * This is the trigger-lane pass rule. For the command lane, use
 * `matchWeaverCommand` instead — it additionally requires a parseable
 * quoted-JSON argument.
 */
export function isWeaverInvocation(command: string, subcommand: string): boolean {
  const escapedSub = subcommand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(?:npx\\s+|pnpm\\s+exec\\s+)?weaver\\s+${escapedSub}\\b`).test(command);
}

/**
 * Returns true when the given bash command invokes `weaver` with any
 * subcommand, tolerating the same `npx`/`pnpm exec` prefix forms as
 * {@link isWeaverInvocation}. Used where the subcommand under test is
 * unknown up front — e.g. a boundary case that must not reach `weaver` at
 * all, regardless of which operation it would have been.
 */
export function isAnyWeaverInvocation(command: string): boolean {
  return /^(?:npx\s+|pnpm\s+exec\s+)?weaver\s+\S+/.test(command);
}

/**
 * Returns the subcommand token of a weaver invocation (e.g. `"search-text"`),
 * or `undefined` when the command is not a weaver invocation. Accepts the same
 * `weaver`/`npx weaver`/`pnpm exec weaver` prefix forms as
 * {@link isAnyWeaverInvocation} and is anchored the same way. The token is
 * returned verbatim, up to the first whitespace — no normalisation.
 */
export function weaverSubcommand(command: string): string | undefined {
  const match = command.match(/^(?:npx\s+|pnpm\s+exec\s+)?weaver\s+(\S+)/);
  return match?.[1];
}

/**
 * Filters tool calls to those with name "bash", returning their command
 * arguments. `&&`-chained commands are split into separate candidates — models
 * legitimately chain a setup step before the command under test (e.g.
 * `cd /workspace && weaver replace-text …`), and `isWeaverInvocation` anchors
 * at the start of the string, so an unsplit chain could never match. Splitting
 * stops at `&&` (not `;`) because semicolons appear inside legitimate JSON
 * pattern arguments. Returns an empty array when no bash calls exist.
 */
export function extractBashCommands(toolCalls: ToolCall[]): string[] {
  return toolCalls
    .filter((tc) => tc.name === "bash")
    .map((tc) => {
      const cmd = tc.arguments.command;
      return typeof cmd === "string" ? cmd : "";
    })
    .flatMap((cmd) => cmd.split(/\s*&&\s*/))
    .map((cmd) => cmd.trim())
    .filter((cmd) => cmd.length > 0);
}

/**
 * Tests whether a bash command string is a valid weaver invocation for the
 * given subcommand with all required key arguments present and matching.
 *
 * Accepts both `weaver <sub> '<json>'` and `pnpm exec weaver <sub> '<json>'`,
 * with single or double quotes around the JSON argument.
 *
 * Failure messages distinguish:
 * - "no weaver attempt" — the command does not invoke weaver at all
 * - "weaver attempted but JSON malformed" — weaver is called but the JSON does not parse
 * - "wrong subcommand" — weaver is called but with a different subcommand
 * - "missing key arg" — weaver and subcommand match but a required arg is absent
 * - "wrong key arg value" — arg is present but has the wrong value
 */
export function matchWeaverCommand(
  command: string,
  subcommand: string,
  keyArgs?: Record<string, unknown>,
): WeaverCommandMatch {
  const { matched, reason } = classifyCommand(command, subcommand, keyArgs);
  const outcome: CommandOutcome = matched
    ? "correct"
    : weaverSubcommand(command) === subcommand
      ? "wrong-args"
      : "wrong-tool";
  return reason === undefined ? { matched, outcome } : { matched, outcome, reason };
}

/**
 * The gate lane's pass predicate for both exposures: true only when `call` is
 * a bash invocation of `expectedCommand` with every `keyArgs` entry present
 * and matching — {@link matchWeaverCommand}'s `"correct"` outcome, not merely
 * reaching the right subcommand. A non-bash call is never a match, regardless
 * of its own arguments. `&&`-chained commands are split the same way
 * {@link extractBashCommands} splits them, so a setup-then-command chain is
 * inspected on its weaver segment.
 */
export function matchesExpectedCommand(
  call: ToolCall,
  expectedCommand: string,
  keyArgs?: Record<string, unknown>,
): boolean {
  // extractBashCommands already filters to bash calls, so a non-bash call
  // yields no candidates here and falls through to `false` on its own — no
  // separate early-return guard needed.
  return extractBashCommands([call]).some(
    (cmd) => matchWeaverCommand(cmd, expectedCommand, keyArgs).matched,
  );
}

function classifyCommand(
  command: string,
  subcommand: string,
  keyArgs: Record<string, unknown> | undefined,
): { matched: boolean; reason?: string } {
  // Match: (npx |pnpm exec )?weaver <subcommand> ['"]...['"]\s*$
  const pattern = /^(?:npx\s+|pnpm\s+exec\s+)?weaver\s+(\S+)\s+(['"])([\s\S]*)\2\s*$/;
  const m = command.match(pattern);

  if (!m) {
    // No prefix alternation here: this check only distinguishes "weaver was
    // attempted" from "weaver wasn't invoked at all", so a bare substring
    // test is enough — the npx/pnpm prefix forms all contain the literal
    // "weaver" token regardless of how they're spaced.
    if (/weaver/.test(command)) {
      // weaver is present but format is unexpected
      return {
        matched: false,
        reason: `weaver attempted but command format not recognised: ${command}`,
      };
    }
    return {
      matched: false,
      reason: `no weaver attempt — command does not invoke weaver: ${command}`,
    };
  }

  const [, actualSubcommand, quote, jsonText] = m;

  if (actualSubcommand !== subcommand) {
    return {
      matched: false,
      reason: `wrong subcommand: expected "${subcommand}", got "${actualSubcommand}"`,
    };
  }

  const parsed = parseJsonArgument(jsonText, quote);
  if (parsed === undefined) {
    return {
      matched: false,
      reason: `weaver attempted but JSON malformed: ${jsonText}`,
    };
  }

  if (keyArgs) {
    for (const [key, expected] of Object.entries(keyArgs)) {
      if (!(key in parsed)) {
        return {
          matched: false,
          reason: `missing key arg "${key}" in ${JSON.stringify(parsed)}`,
        };
      }
      const argMatches = PATH_KEY_ARGS.has(key)
        ? pathArgMatches(expected, parsed[key])
        : parsed[key] === expected;
      if (!argMatches) {
        return {
          matched: false,
          reason: `wrong key arg value for "${key}": expected ${JSON.stringify(expected)}, got ${JSON.stringify(parsed[key])}`,
        };
      }
    }
  }

  return { matched: true };
}

/**
 * Compares a path-valued key arg, accepting the workspace-relative form a model
 * emits after `cd`-ing into the workspace. `expected` is the case-authored
 * absolute path; `actual` matches when it equals `expected` or is a trailing
 * path-segment suffix of it (`src/utils` vs `/ws/src/utils`). The leading `/`
 * in the suffix check enforces a segment boundary, so `ils.ts` does not match
 * `/ws/src/utils.ts` while `utils.ts` does. A different directory (`src/wrong`)
 * is still rejected. Non-string values fall back to exact equality.
 */
function pathArgMatches(expected: unknown, actual: unknown): boolean {
  if (typeof expected !== "string" || typeof actual !== "string") {
    return expected === actual;
  }
  return expected === actual || expected.endsWith(`/${actual}`);
}

// A double-quoted argument usually carries bash-escaped inner quotes
// (`"{\"k\":\"v\"}"`); retry with the escapes removed so that form is not
// misreported as malformed JSON.
function parseJsonArgument(jsonText: string, quote: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    if (quote !== '"') {
      return undefined;
    }
  }
  try {
    return JSON.parse(jsonText.replace(/\\"/g, '"')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
