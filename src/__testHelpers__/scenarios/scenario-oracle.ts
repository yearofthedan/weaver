import { expect } from "vitest";
import type { DispatchResponse } from "../../daemon/dispatcher.js";
import { type Effects, expandResponseSugar } from "./scenario-schema.js";

export type Tree = Record<string, string>;

export function assertEffects(before: Tree, after: Tree, effects: Effects): void {
  for (const [from, target] of Object.entries(effects.moved)) {
    // Without this, a `moved` naming a source that was never there passes on both halves:
    // nothing is at the source afterwards, and the destination matches its absent content.
    expect(before[from], `${from} should have existed beforehand`).toBeDefined();
    expect(after[from], `${from} should have moved away`).toBeUndefined();
    if (target.content === undefined) {
      expect(
        after[target.to],
        `${target.to} should exist, with content intact, after the move`,
      ).toBe(before[from]);
    } else {
      expect(after[target.to], `${target.to} content after the move`).toBe(target.content);
    }
  }

  for (const [file, content] of Object.entries(effects.changed)) {
    expect(after[file], `${file} was listed as changed but is identical`).not.toBe(before[file]);
    expect(after[file], `${file} content`).toBe(content);
  }

  for (const file of effects.unchanged) {
    expect(before[file], `${file} should have existed beforehand`).toBeDefined();
    expect(after[file], `${file} should have been left alone`).toBe(before[file]);
  }

  const claimed = new Set([
    ...Object.keys(effects.moved),
    ...Object.values(effects.moved).map((target) => target.to),
    ...Object.keys(effects.changed),
    ...effects.unchanged,
  ]);
  const unaccounted = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((file) => !claimed.has(file) && before[file] !== after[file])
    .sort();
  expect(unaccounted, "files changed without being named in `then.files`").toEqual([]);
}

/**
 * Exact equality against the response a scenario documents, so a field appearing that the
 * file does not mention fails here — the one place per operation that has to be looked at
 * when the shape a consumer receives grows.
 */
export function assertResponseMatches(written: Record<string, unknown>, actual: unknown): void {
  expect(actual, "response").toEqual(expandResponseSugar(written));
}

/**
 * A step in a sequence carries no stated response, so the only thing holding it is that it
 * worked. `warn` is a success that also reported a type error, which a scenario is free to
 * end in; `error` means the run stopped being the one the scenario describes.
 */
export function assertStepSucceeded(method: string, result: DispatchResponse): void {
  expect(result.status, `step \`${method}\` status (${String(result.message ?? "")})`).not.toBe(
    "error",
  );
}

/**
 * Lead a failure with the scenario's own account of itself. A case pinning behaviour we
 * know is wrong expects content that looks like a bug, so without this the next reader
 * has to find the file to learn the expectation is deliberate.
 */
export function describeFailure(error: unknown, description: string | undefined): unknown {
  if (description === undefined || !(error instanceof Error)) return error;
  error.message = `${description}\n\n${error.message}`;
  return error;
}
