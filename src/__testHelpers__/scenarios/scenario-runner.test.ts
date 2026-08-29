import { describe, expect, it } from "vitest";
import { fixtureTest as test } from "../helpers.js";
import { assertEffects, assertResponseMatches, type Tree } from "./scenario-oracle.js";
import { executeScenario, parseScenarios } from "./scenario-runner.js";
import type { Effects } from "./scenario-schema.js";

/**
 * The scenario harness is a shared oracle: if its comparison is wrong, every scenario can
 * pass for the wrong reason. These cases each state one wrong expectation about a move that
 * really happens, and assert the harness rejects it.
 */

const GIVEN = `    given:
      files:
        tsconfig.json: |
          { "compilerOptions": { "strict": true }, "include": ["src/**/*.ts"] }
        src/utils.ts: |
          export function greetUser(name: string): string {
            return \`Hello, \${name}\`;
          }
        src/main.ts: |
          import { greetUser } from "./utils";

          console.log(greetUser("World"));
`;

/** What the dispatcher really returns for the move every case below performs. */
const RESPONSE = `      response:
        status: success
        typeErrors: none
        filesModified: [src/main.ts, lib/utils.ts]
        filesSkipped: []
        oldPath: src/utils.ts
        newPath: lib/utils.ts`;

/** The importer rewrite the move really performs, as a `changed` entry. */
const CHANGED_MAIN = `        changed:
          src/main.ts: |
            import { greetUser } from "../lib/utils";

            console.log(greetUser("World"));`;

const MOVED = `        moved:
          src/utils.ts: lib/utils.ts`;

/** A move of src/utils.ts to lib/utils.ts, with whatever `then` block the case is testing. */
function moveScenario(then: string): string {
  return `scenarios:
  - name: the case under test
${GIVEN}
    when:
      - moveFile: { oldPath: src/utils.ts, newPath: lib/utils.ts }
    then:
${then}`;
}

async function rejectionOf(yaml: string, dir: string): Promise<string> {
  const file = parseScenarios(yaml);
  try {
    await executeScenario(file.scenarios[0], file, dir);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("the harness accepted a scenario it should have rejected");
}

/**
 * The workspace the effect cases judge: src/utils.ts imported once from src/main.ts, with
 * a tsconfig beside them.
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

function effectsOf(parts: Partial<Effects> = {}): Effects {
  return { moved: {}, changed: {}, unchanged: [], ...parts };
}

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

function failureOf(assert: () => void): string {
  try {
    assert();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("the oracle accepted a contract it should have rejected");
}

describe("effect contract", () => {
  const CLEAN = effectsOf({
    moved: { "src/utils.ts": { to: "lib/utils.ts" } },
    changed: { "src/main.ts": AFTER["src/main.ts"] },
    unchanged: ["tsconfig.json"],
  });

  it("passes when every declared effect holds and no unnamed file differs", () => {
    assertEffects(BEFORE, AFTER, CLEAN);
  });

  it("accepts a move whose declared content is what landed", () => {
    const rewritten = "rewritten on the way\n";

    assertEffects(
      BEFORE,
      { ...AFTER, "lib/utils.ts": rewritten },
      {
        ...CLEAN,
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
        ...CLEAN,
        changed: { "src/main.ts": 'import { greetUser } from "./stale-path";\n' },
      }),
    );

    expect(message).toContain("src/main.ts content");
  });

  it("rejects a file listed as `changed` that was left alone", () => {
    const message = failureOf(() =>
      assertEffects(BEFORE, AFTER, {
        ...CLEAN,
        changed: { ...CLEAN.changed, "tsconfig.json": BEFORE["tsconfig.json"] },
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
        ...CLEAN,
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
        ...CLEAN,
        moved: { ...CLEAN.moved, "src/ghost.ts": { to: "lib/ghost.ts" } },
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

describe("path handling", () => {
  test("scrubs the temp root so a passing response reads as workspace-relative", async ({
    dir,
  }) => {
    const file = parseScenarios(
      moveScenario(`${RESPONSE}
      files:
${MOVED}
${CHANGED_MAIN}`),
    );

    await expect(executeScenario(file.scenarios[0], file, dir)).resolves.toBeUndefined();
  });
});

describe("scenario description", () => {
  test("puts the description in front of the failure, so a deliberate expectation reads as one", async ({
    dir,
  }) => {
    const described = `scenarios:
  - name: the case under test
    description: the scan never considers this specifier, so the stale path is expected
${GIVEN}
    when:
      - moveFile: { oldPath: src/utils.ts, newPath: lib/utils.ts }
    then:
${RESPONSE}
      files:
${MOVED}`;

    const message = await rejectionOf(described, dir);

    expect(message).toContain("the scan never considers this specifier");
    expect(message).toContain("files changed without being named in `then.files`");
  });

  test("leaves the failure alone when the scenario carries no description", async ({ dir }) => {
    const message = await rejectionOf(
      moveScenario(`${RESPONSE}
      files:
${MOVED}`),
      dir,
    );

    expect(message).toMatch(/^files changed without being named/);
  });
});
