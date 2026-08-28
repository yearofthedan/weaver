import { describe, expect } from "vitest";
import { fixtureTest as test } from "../helpers.js";
import { executeScenario, parseScenarios } from "./scenario-runner.js";

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

describe("effect contract", () => {
  test("rejects a modification no `then.files` entry claims", async ({ dir }) => {
    const message = await rejectionOf(
      moveScenario(`${RESPONSE}
      files:
${MOVED}`),
      dir,
    );

    expect(message).toContain("files changed without being named in `then.files`");
    expect(message).toContain("src/main.ts");
  });

  test("rejects a scenario claiming nothing happened at all", async ({ dir }) => {
    const message = await rejectionOf(moveScenario(RESPONSE), dir);

    // The destination did not exist before and the source is gone after, so a scenario
    // claiming no effects has to fail on both.
    expect(message).toContain("files changed without being named in `then.files`");
    expect(message).toContain("lib/utils.ts");
  });

  test("rejects `changed` content that does not match the file on disk", async ({ dir }) => {
    const message = await rejectionOf(
      moveScenario(`${RESPONSE}
      files:
${MOVED}
        changed:
          src/main.ts: |
            import { greetUser } from "./stale-path";`),
      dir,
    );

    expect(message).toContain("src/main.ts content");
  });

  test("rejects a file listed as `changed` that the operation left alone", async ({ dir }) => {
    const message = await rejectionOf(
      moveScenario(`${RESPONSE}
      files:
${MOVED}
${CHANGED_MAIN}
          tsconfig.json: |
            { "compilerOptions": { "strict": true }, "include": ["src/**/*.ts"] }`),
      dir,
    );

    expect(message).toContain("tsconfig.json was listed as changed but is identical");
  });

  test("rejects a move whose declared destination is not where the file landed", async ({
    dir,
  }) => {
    const message = await rejectionOf(
      moveScenario(`${RESPONSE}
      files:
        moved:
          src/utils.ts: lib/elsewhere.ts`),
      dir,
    );

    expect(message).toContain("lib/elsewhere.ts should exist, with content intact");
  });

  test("rejects a declared move whose source is still sitting there", async ({ dir }) => {
    // A copy that leaves the original behind passes the totality check — the source is
    // byte-identical, so nothing reads as changed. Only this assertion catches it.
    const message = await rejectionOf(
      moveScenario(`${RESPONSE}
      files:
        moved:
          tsconfig.json: lib/tsconfig.json`),
      dir,
    );

    expect(message).toContain("tsconfig.json should have moved away");
  });

  test("rejects a file declared `unchanged` that the operation rewrote", async ({ dir }) => {
    const message = await rejectionOf(
      moveScenario(`${RESPONSE}
      files:
${MOVED}
        unchanged: [src/main.ts]`),
      dir,
    );

    expect(message).toContain("src/main.ts should have been left alone");
  });

  test("rejects `unchanged` naming a file the fixture never seeded", async ({ dir }) => {
    const message = await rejectionOf(
      moveScenario(`${RESPONSE}
      files:
        unchanged: [src/never-existed.ts]`),
      dir,
    );

    expect(message).toContain("src/never-existed.ts should have existed beforehand");
  });
});

describe("response contract", () => {
  test("rejects a written response whose field value is wrong", async ({ dir }) => {
    const message = await rejectionOf(
      moveScenario(`      response:
        status: warn
        typeErrors: none
        filesModified: [src/main.ts, lib/utils.ts]
        filesSkipped: []
        oldPath: src/utils.ts
        newPath: lib/utils.ts
      files:
${MOVED}
${CHANGED_MAIN}`),
      dir,
    );

    expect(message).toContain("response:");
    expect(message).toContain("warn");
  });

  test("rejects a written response that omits a field the dispatcher returns", async ({ dir }) => {
    const message = await rejectionOf(
      moveScenario(`      response:
        status: success
        filesModified: [src/main.ts, lib/utils.ts]
        filesSkipped: []
        oldPath: src/utils.ts
        newPath: lib/utils.ts
      files:
${MOVED}
${CHANGED_MAIN}`),
      dir,
    );

    // Exact equality is what stops a consumer-visible field being dropped unnoticed.
    expect(message).toContain("response:");
    expect(message).toContain("to deeply equal");
  });

  test("rejects a written response carrying a field the dispatcher never returns", async ({
    dir,
  }) => {
    const message = await rejectionOf(
      moveScenario(`${RESPONSE}
        invented: true
      files:
${MOVED}
${CHANGED_MAIN}`),
      dir,
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
