import type { ToolCall } from "./call-model.js";

export interface WeaverCommandMatch {
  matched: boolean;
  /** Populated when matched is false. */
  reason?: string;
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
  // Match: (pnpm exec )?weaver <subcommand> ['"]...['"]\s*$
  const pattern = /^(?:pnpm\s+exec\s+)?weaver\s+(\S+)\s+(['"])([\s\S]*)\2\s*$/;
  const m = command.match(pattern);

  if (!m) {
    if (/(?:pnpm\s+exec\s+)?weaver/.test(command)) {
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

  const [, actualSubcommand, , jsonText] = m;

  if (actualSubcommand !== subcommand) {
    return {
      matched: false,
      reason: `wrong subcommand: expected "${subcommand}", got "${actualSubcommand}"`,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
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
