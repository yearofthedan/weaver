import type { ToolCall } from "./call-model.js";

export interface WeaverCommandMatch {
  matched: boolean;
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
 * Filters tool calls to those with name "bash", returning their command argument.
 * Returns an empty array when no bash calls exist.
 */
export function extractBashCommands(toolCalls: ToolCall[]): string[] {
  return toolCalls
    .filter((tc) => tc.name === "bash")
    .map((tc) => {
      const cmd = tc.arguments.command;
      return typeof cmd === "string" ? cmd : "";
    })
    .filter((cmd) => cmd.length > 0);
}

/**
 * Extracts the shell command from a plain-text model response: strips markdown
 * code fences, splits `&&`-chained commands into separate candidates — models
 * legitimately chain a safety check before a destructive command — and returns
 * one trimmed candidate per segment. Splitting stops at `&&` (not `;`) because
 * semicolons appear inside legitimate JSON pattern arguments. Returns an empty
 * array for blank responses.
 */
export function extractCommandsFromText(text: string): string[] {
  const stripped = text.replace(/^```[a-z]*\n?/gm, "").replace(/^```\s*$/gm, "");
  return stripped
    .split("\n")
    .flatMap((line) => line.split(/\s*&&\s*/))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
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
  // Match: (npx |pnpm exec )?weaver <subcommand> ['"]...['"]\s*$
  const pattern = /^(?:npx\s+|pnpm\s+exec\s+)?weaver\s+(\S+)\s+(['"])([\s\S]*)\2\s*$/;
  const m = command.match(pattern);

  if (!m) {
    if (/(?:npx\s+|pnpm\s+exec\s+)?weaver/.test(command)) {
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
      if (parsed[key] !== expected) {
        return {
          matched: false,
          reason: `wrong key arg value for "${key}": expected ${JSON.stringify(expected)}, got ${JSON.stringify(parsed[key])}`,
        };
      }
    }
  }

  return { matched: true };
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
