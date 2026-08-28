import { z } from "zod";

/** A fixture is setup, so every entry is file content — assertion modes belong in `then`. */
const fixtureBody = z.object({
  description: z.string().optional(),
  extends: z.string().optional(),
  files: z.record(z.string(), z.string()).default({}),
});

export type FixtureBody = z.infer<typeof fixtureBody>;

/**
 * The effect contract: what the operation did to the workspace, grouped by outcome.
 *
 * Any file not named here must be untouched — the runner fails on a change it was not
 * told to expect, which is what makes the contract total rather than a set of probes.
 *
 * `unchanged` is therefore not bookkeeping: it names a file the tool was *right* to
 * leave alone, so the non-change reads as the point of the scenario rather than as
 * something nobody got around to asserting.
 */
/**
 * Where a moved file landed. The string form asserts the destination is byte-identical to
 * what the source held; the object form states new content, for a move that rewrites the
 * file's own imports on the way.
 */
const moveTarget = z
  .union([z.string(), z.object({ to: z.string(), content: z.string() })])
  .transform((value): { to: string; content?: string } =>
    typeof value === "string" ? { to: value } : value,
  );

const effects = z
  .object({
    moved: z.record(z.string(), moveTarget).default({}),
    changed: z.record(z.string(), z.string()).default({}),
    unchanged: z.array(z.string()).default([]),
  })
  .prefault({});

export type Effects = z.infer<typeof effects>;

/**
 * The response contract: the JSON the daemon returns, which the CLI passes through to
 * the calling agent verbatim.
 *
 * A single-step scenario must state it, asserted by deep equality, so a renamed, dropped,
 * added or retyped field fails here.
 *
 * A multi-step scenario states no response. Each step is its own call with its own
 * response, so a top-level block could only approve the last one — leaving the earlier
 * calls unasserted while looking total. Those scenarios exist to prove state carried
 * between calls is correct, which the net file effects show; the runner still requires
 * every step to have succeeded.
 *
 * Field names are the ones a consumer receives, deliberately: renaming them here would put
 * a mapping layer between the file and the contract, which is where a silent break hides.
 * Paths are workspace-relative; the runner scrubs the temp root before comparing.
 */
const response = z.record(z.string(), z.unknown());

/** Expand `typeErrors: none` into the three fields a clean type check actually returns. */
export function expandResponseSugar(written: Record<string, unknown>): Record<string, unknown> {
  if (written.typeErrors !== "none") return written;
  const { typeErrors: _sugar, ...rest } = written;
  return { ...rest, typeErrors: [], typeErrorCount: 0, typeErrorsTruncated: false };
}

/** One dispatcher call: the sole key is the method name, its value the request params. */
const step = z
  .record(z.string(), z.record(z.string(), z.unknown()))
  .refine((value) => Object.keys(value).length === 1, {
    // Zod 4 takes the dynamic message as `error`, reading the failing value off the issue.
    // The Zod 3 shape — a function returning `{ message }` — is ignored, leaving "Invalid input".
    error: (issue) =>
      `a step declares exactly one method, got: ${Object.keys(issue.input as object).join(", ")}`,
  });

export type Step = z.infer<typeof step>;

const scenario = z
  .object({
    name: z.string(),
    /** Why the expectation below is what it is. Reaches a failure message, nothing else. */
    description: z.string().optional(),
    given: z.union([z.string(), fixtureBody]),
    when: z.array(step).min(1),
    // biome-ignore lint/suspicious/noThenProperty: `then` is the Given/When/Then vocabulary these files are written in; renaming it internally would put a mapping layer between the YAML and the parsed object, and a scenario is never awaited so being thenable is inert.
    then: z.object({ response: response.optional(), files: effects }),
  })
  .refine((value) => value.when.length > 1 || value.then.response !== undefined, {
    error: "a single-step scenario must state the response a consumer receives",
  })
  .refine((value) => value.when.length === 1 || value.then.response === undefined, {
    error: "a multi-step scenario asserts the net file effects, not one step's response",
  });

export type Scenario = z.infer<typeof scenario>;

export const scenarioFile = z.object({
  fixtures: z.record(z.string(), fixtureBody).default({}),
  scenarios: z.array(scenario).min(1),
});

export type ScenarioFile = z.infer<typeof scenarioFile>;

/** Flatten an `extends` chain into one set of files, later layers overwriting earlier. */
export function resolveFixture(
  given: string | FixtureBody,
  fixtures: Record<string, FixtureBody>,
): Record<string, string> {
  const chain: FixtureBody[] = [];
  const seen: string[] = [];

  let current: string | FixtureBody | undefined = given;
  while (current !== undefined) {
    let body: FixtureBody;
    if (typeof current === "string") {
      if (seen.includes(current)) {
        throw new Error(`Circular fixture extends: ${[...seen, current].join(" -> ")}`);
      }
      seen.push(current);
      const named = fixtures[current];
      if (named === undefined) {
        throw new Error(`Unknown fixture "${current}"`);
      }
      body = named;
    } else {
      body = current;
    }
    chain.unshift(body);
    current = body.extends;
  }

  const files: Record<string, string> = {};
  for (const body of chain) {
    Object.assign(files, body.files);
  }
  return files;
}
