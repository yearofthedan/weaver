import { describe, expect, it } from "vitest";
import { fixtureTest as test } from "../helpers.js";
import {
  assertEffects,
  assertResponseMatches,
  assertStepSucceeded,
  describeFailure,
  type Tree,
} from "./scenario-oracle.js";
import { executeScenario } from "./scenario-runner.js";
import type { Effects, Scenario, ScenarioFile } from "./scenario-schema.js";

/**
 * The scenario harness is a shared oracle: if its comparison is wrong, every scenario can
 * pass for the wrong reason. Its assertions are pure functions of the values they judge,
 * so most cases state one wrong contract about a known workspace change and watch the
 * oracle reject it — no project, no dispatch.
 */

/**
 * The workspace the cases judge: src/utils.ts imported once from src/main.ts, with a
 * tsconfig beside them.
 */
const BEFORE: Tree = {
  "tsconfig.json": `{ "compilerOptions": { "strict": true }, "include": ["src/**/*.ts"] }
`,
  "src/main.ts": `import { greetUser } from "./utils";

console.log(greetUser("World"));
`,
  "src/utils.ts": `export function greetUser(name: string): string {
  return \`Hello, \${name}\`;
}
`,
};

/** What moving src/utils.ts to lib/utils.ts leaves behind, the importer rewritten. */
const AFTER: Tree = {
  "tsconfig.json": BEFORE["tsconfig.json"],
  "lib/utils.ts": BEFORE["src/utils.ts"],
  "src/main.ts": `import { greetUser } from "../lib/utils";

console.log(greetUser("World"));
`,
};

/** The effect contract that move really performs: the move, the rewrite, the bystander. */
const CLEAN_EFFECTS: Effects = {
  moved: { "src/utils.ts": { to: "lib/utils.ts" } },
  changed: { "src/main.ts": AFTER["src/main.ts"] },
  unchanged: ["tsconfig.json"],
};

/** The response the dispatcher really returns for that move, in the sugar form files write. */
const WRITTEN_RESPONSE: Record<string, unknown> = {
  status: "success",
  typeErrors: "none",
  filesModified: ["src/main.ts", "lib/utils.ts"],
  filesSkipped: [],
  oldPath: "src/utils.ts",
  newPath: "lib/utils.ts",
};

/** The same response already scrubbed of the temp root, as the executor passes it in. */
const SCRUBBED_RESPONSE = {
  status: "success",
  typeErrors: [],
  typeErrorCount: 0,
  typeErrorsTruncated: false,
  filesModified: ["src/main.ts", "lib/utils.ts"],
  filesSkipped: [],
  oldPath: "src/utils.ts",
  newPath: "lib/utils.ts",
};

function effectsOf(parts: Partial<Effects> = {}): Effects {
  return { moved: {}, changed: {}, unchanged: [], ...parts };
}

function failureOf(assert: () => void): string {
  try {
    assert();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("the oracle accepted a contract it should have rejected");
}

describe("effect contract", () => {
  it("passes when every declared effect holds and no unnamed file differs", () => {
    assertEffects(BEFORE, AFTER, CLEAN_EFFECTS);
  });

  it("accepts a move whose declared content is what landed", () => {
    const rewritten = "rewritten on the way\n";

    assertEffects(
      BEFORE,
      { ...AFTER, "lib/utils.ts": rewritten },
      {
        ...CLEAN_EFFECTS,
        moved: { "src/utils.ts": { to: "lib/utils.ts", content: rewritten } },
      },
    );
  });

  it("passes on an empty workspace with nothing declared", () => {
    assertEffects({}, {}, effectsOf());
  });

  it("rejects any effect against an empty workspace", () => {
    const message = failureOf(() =>
      assertEffects({}, {}, effectsOf({ moved: { "a.ts": { to: "b.ts" } } })),
    );

    expect(message).toContain("a.ts should have existed beforehand");
  });

  it("rejects a modification no `then.files` entry claims", () => {
    const message = failureOf(() =>
      assertEffects(
        BEFORE,
        AFTER,
        effectsOf({ moved: { "src/utils.ts": { to: "lib/utils.ts" } } }),
      ),
    );

    expect(message).toContain("files changed without being named in `then.files`");
    expect(message).toContain("src/main.ts");
  });

  it("rejects a claim that nothing happened at all", () => {
    const message = failureOf(() => assertEffects(BEFORE, AFTER, effectsOf()));

    // The destination did not exist before and the source is gone after, so a claim of
    // no effects has to fail on both.
    expect(message).toContain("files changed without being named in `then.files`");
    expect(message).toContain("lib/utils.ts");
  });

  it("rejects `changed` content that does not match the file on disk", () => {
    const message = failureOf(() =>
      assertEffects(BEFORE, AFTER, {
        ...CLEAN_EFFECTS,
        changed: { "src/main.ts": 'import { greetUser } from "./stale-path";\n' },
      }),
    );

    expect(message).toContain("src/main.ts content");
  });

  it("rejects a file listed as `changed` that was left alone", () => {
    const message = failureOf(() =>
      assertEffects(BEFORE, AFTER, {
        ...CLEAN_EFFECTS,
        changed: { ...CLEAN_EFFECTS.changed, "tsconfig.json": BEFORE["tsconfig.json"] },
      }),
    );

    expect(message).toContain("tsconfig.json was listed as changed but is identical");
  });

  it("rejects a move whose declared destination is not where the file landed", () => {
    const message = failureOf(() =>
      assertEffects(
        BEFORE,
        AFTER,
        effectsOf({ moved: { "src/utils.ts": { to: "lib/elsewhere.ts" } } }),
      ),
    );

    expect(message).toContain("lib/elsewhere.ts should exist, with content intact");
  });

  it("rejects a declared move whose source is still sitting there", () => {
    // A copy that leaves the original behind passes the totality check — the source is
    // byte-identical, so nothing reads as changed. Only this assertion catches it.
    const message = failureOf(() =>
      assertEffects(
        BEFORE,
        { ...BEFORE, "lib/tsconfig.json": BEFORE["tsconfig.json"] },
        effectsOf({ moved: { "tsconfig.json": { to: "lib/tsconfig.json" } } }),
      ),
    );

    expect(message).toContain("tsconfig.json should have moved away");
  });

  it("rejects a file declared `unchanged` that was rewritten", () => {
    const message = failureOf(() =>
      assertEffects(BEFORE, AFTER, {
        ...CLEAN_EFFECTS,
        changed: {},
        unchanged: ["src/main.ts"],
      }),
    );

    expect(message).toContain("src/main.ts should have been left alone");
  });

  it("rejects `unchanged` naming a file that never existed", () => {
    const message = failureOf(() =>
      assertEffects(BEFORE, BEFORE, effectsOf({ unchanged: ["src/never-existed.ts"] })),
    );

    expect(message).toContain("src/never-existed.ts should have existed beforehand");
  });

  it("rejects a `moved` entry whose source was never in the workspace", () => {
    // Both halves of the move assertion read as satisfied when the source is absent: nothing
    // is there afterwards, and the destination matches the source's equally absent content.
    const message = failureOf(() =>
      assertEffects(BEFORE, AFTER, {
        ...CLEAN_EFFECTS,
        moved: { ...CLEAN_EFFECTS.moved, "src/ghost.ts": { to: "lib/ghost.ts" } },
      }),
    );

    expect(message).toContain("src/ghost.ts");
  });
});

describe("response contract", () => {
  it("passes when the written block, sugar expanded, is exactly what was returned", () => {
    assertResponseMatches(WRITTEN_RESPONSE, SCRUBBED_RESPONSE);
  });

  it("rejects a written response whose field value is wrong", () => {
    const message = failureOf(() =>
      assertResponseMatches({ ...WRITTEN_RESPONSE, status: "warn" }, SCRUBBED_RESPONSE),
    );

    expect(message).toContain("response:");
    expect(message).toContain("warn");
  });

  it("rejects a written response that omits a field the dispatcher returns", () => {
    const { typeErrors: _sugar, ...omitted } = WRITTEN_RESPONSE;

    const message = failureOf(() => assertResponseMatches(omitted, SCRUBBED_RESPONSE));

    // Exact equality is what stops a consumer-visible field being dropped unnoticed.
    expect(message).toContain("response:");
    expect(message).toContain("to deeply equal");
  });

  it("rejects a written response carrying a field the dispatcher never returns", () => {
    const message = failureOf(() =>
      assertResponseMatches({ ...WRITTEN_RESPONSE, invented: true }, SCRUBBED_RESPONSE),
    );

    expect(message).toContain("response:");
  });
});

describe("step status", () => {
  it("rejects an `error` status, naming the step and its message", () => {
    const message = failureOf(() =>
      assertStepSucceeded("moveFile", {
        status: "error",
        error: "FILE_NOT_FOUND",
        message: "File not found: src/missing.ts",
      }),
    );

    expect(message).toContain("step `moveFile` status");
    expect(message).toContain("File not found: src/missing.ts");
  });

  it("passes `success`", () => {
    assertStepSucceeded("moveFile", { status: "success" });
  });

  it("passes `warn`, a success that also reported a type error", () => {
    assertStepSucceeded("moveFile", { status: "warn", typeErrorCount: 1 });
  });
});

describe("failure description", () => {
  it("puts the description in front of the failure, so a deliberate expectation reads as one", () => {
    const error = new Error("files changed without being named in `then.files`");

    const described = describeFailure(error, "the stale path is expected");

    expect(described).toBe(error);
    expect(error.message).toBe(
      "the stale path is expected\n\nfiles changed without being named in `then.files`",
    );
  });

  it("leaves the failure alone when there is no description", () => {
    const error = new Error("files changed without being named in `then.files`");

    const returned = describeFailure(error, undefined);

    expect(returned).toBe(error);
    expect(error.message).toBe("files changed without being named in `then.files`");
  });

  it("returns a non-Error failure unchanged", () => {
    expect(describeFailure("something threw", "a description")).toBe("something threw");
  });
});

/**
 * A scenario over the shared workspace, with the step list and outcome block per case.
 *
 * Call sites say `outcome` so the format's `then` key appears once, here. A scenario is
 * never awaited, so being thenable is inert, and one suppression beats one per case.
 */
function scenarioOf(parts: {
  name: string;
  description?: string;
  when: Scenario["when"];
  outcome: Scenario["then"];
}): Scenario {
  return {
    name: parts.name,
    description: parts.description,
    given: { files: BEFORE },
    when: parts.when,
    // biome-ignore lint/suspicious/noThenProperty: the Given/When/Then vocabulary of the format under test.
    then: parts.outcome,
  };
}

function scenarioFileOf(scenario: Scenario): ScenarioFile {
  return { fixtures: {}, scenarios: [scenario] };
}

describe("executor wiring", () => {
  test("scrubs the temp root so a passing response reads as workspace-relative", async ({
    dir,
  }) => {
    const file = scenarioFileOf(
      scenarioOf({
        name: "a single move with its response stated",
        when: [{ moveFile: { oldPath: "src/utils.ts", newPath: "lib/utils.ts" } }],
        outcome: { response: WRITTEN_RESPONSE, files: CLEAN_EFFECTS },
      }),
    );

    await expect(executeScenario(file.scenarios[0], file, dir)).resolves.toBeUndefined();
  });

  test("puts the description in front of the failure, so a deliberate expectation reads as one", async ({
    dir,
  }) => {
    const file = scenarioFileOf(
      scenarioOf({
        name: "a deliberately wrong expectation",
        description: "the scan never considers this specifier, so the stale path is expected",
        when: [{ moveFile: { oldPath: "src/utils.ts", newPath: "lib/utils.ts" } }],
        outcome: {
          response: WRITTEN_RESPONSE,
          files: effectsOf({ moved: { "src/utils.ts": { to: "lib/utils.ts" } } }),
        },
      }),
    );

    // Two pattern assertions against the one stored rejection both run.
    const execution = executeScenario(file.scenarios[0], file, dir);

    await expect(execution).rejects.toThrow(/^the scan never considers this specifier/);
    await expect(execution).rejects.toThrow("files changed without being named in `then.files`");
  });

  test("runs every step of a sequence and judges the net effects, since no step states a response", async ({
    dir,
  }) => {
    const file = scenarioFileOf(
      scenarioOf({
        name: "two moves in turn",
        when: [
          { moveFile: { oldPath: "src/utils.ts", newPath: "lib/utils.ts" } },
          { moveFile: { oldPath: "lib/utils.ts", newPath: "dist/utils.ts" } },
        ],
        outcome: {
          files: {
            moved: { "src/utils.ts": { to: "dist/utils.ts" } },
            changed: {
              "src/main.ts": `import { greetUser } from "../dist/utils";

console.log(greetUser("World"));
`,
            },
            unchanged: ["tsconfig.json"],
          },
        },
      }),
    );

    await expect(executeScenario(file.scenarios[0], file, dir)).resolves.toBeUndefined();
  });
});
