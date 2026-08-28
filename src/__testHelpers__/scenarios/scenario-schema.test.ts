import { describe, expect, it } from "vitest";
import { expandResponseSugar, resolveFixture, scenarioFile } from "./scenario-schema.js";

const SUCCESS = { response: { status: "success" } };

/**
 * A parseable scenario, with the step list and outcome block overridable per case.
 *
 * Call sites say `outcome` so the format's `then` key appears once, here. A scenario is
 * never awaited, so being thenable is inert, and one suppression beats one per test.
 */
function scenarioOf(parts: { when?: unknown; outcome?: unknown } = {}): unknown {
  return {
    name: "a scenario",
    given: { files: { "a.ts": "" } },
    when: parts.when ?? [{ moveFile: { oldPath: "a.ts", newPath: "b.ts" } }],
    // biome-ignore lint/suspicious/noThenProperty: the Given/When/Then vocabulary of the format under test.
    then: "outcome" in parts ? parts.outcome : SUCCESS,
  };
}

describe("scenarioFile", () => {
  it("rejects a file with no scenarios, so an empty suite cannot pass silently", () => {
    expect(() => scenarioFile.parse({ scenarios: [] })).toThrow();
  });

  it("rejects a step declaring two methods, naming both", () => {
    const parse = () =>
      scenarioFile.parse({
        scenarios: [scenarioOf({ when: [{ moveFile: {}, renameSymbol: {} }] })],
      });

    expect(parse).toThrow(/exactly one method, got: moveFile, renameSymbol/);
  });

  it("accepts a sequence of steps, which is how state carried between calls is tested", () => {
    const file = scenarioFile.parse({
      scenarios: [
        scenarioOf({ when: [{ moveFile: {} }, { moveFile: {} }], outcome: { files: {} } }),
      ],
    });

    expect(file.scenarios[0].when).toHaveLength(2);
  });

  it("rejects a multi-step scenario that states a response, which could only be the last", () => {
    const parse = () =>
      scenarioFile.parse({
        scenarios: [scenarioOf({ when: [{ moveFile: {} }, { moveFile: {} }] })],
      });

    expect(parse).toThrow(/net file effects, not one step's response/);
  });

  it("reads a plain destination as a move that leaves content untouched", () => {
    const file = scenarioFile.parse({
      scenarios: [scenarioOf({ outcome: { ...SUCCESS, files: { moved: { "a.ts": "b.ts" } } } })],
    });

    expect(file.scenarios[0].then.files.moved["a.ts"]).toEqual({ to: "b.ts" });
  });

  it("reads the object form as a move that rewrites the file on the way", () => {
    const moved = { "a.ts": { to: "b.ts", content: "rewritten\n" } };
    const file = scenarioFile.parse({
      scenarios: [scenarioOf({ outcome: { ...SUCCESS, files: { moved } } })],
    });

    expect(file.scenarios[0].then.files.moved["a.ts"]).toEqual({
      to: "b.ts",
      content: "rewritten\n",
    });
  });

  it("defaults the effect contract, so omitting `files` claims nothing changed", () => {
    const file = scenarioFile.parse({ scenarios: [scenarioOf()] });

    expect(file.scenarios[0].then.files).toEqual({ moved: {}, changed: {}, unchanged: [] });
  });

  it("rejects a scenario that states no response, the contract a consumer receives", () => {
    const parse = () => scenarioFile.parse({ scenarios: [scenarioOf({ outcome: { files: {} } })] });

    expect(parse).toThrow(/must state the response a consumer receives/);
  });

  it("keeps a scenario's description, which the runner puts in front of a failure", () => {
    const file = scenarioFile.parse({
      scenarios: [{ ...(scenarioOf() as object), description: "the stale path is deliberate" }],
    });

    expect(file.scenarios[0].description).toBe("the stale path is deliberate");
  });

  it("drops keys the schema does not declare instead of rejecting them", () => {
    const file = scenarioFile.parse({
      scenarios: [{ ...(scenarioOf() as object), invented: "ignored" }],
    });

    expect(file.scenarios[0]).not.toHaveProperty("invented");
  });
});

describe("resolveFixture", () => {
  const fixtures = {
    base: { files: { "tsconfig.json": "{}", "a.ts": "base" } },
    child: { extends: "base", files: { "a.ts": "child", "b.ts": "added" } },
  };

  it("layers an extends chain so the later fixture wins", () => {
    expect(resolveFixture("child", fixtures)).toEqual({
      "tsconfig.json": "{}",
      "a.ts": "child",
      "b.ts": "added",
    });
  });

  it("lets an inline fixture extend a named one", () => {
    const given = { extends: "base", files: { "a.ts": "inline" } };

    expect(resolveFixture(given, fixtures)).toEqual({ "tsconfig.json": "{}", "a.ts": "inline" });
  });

  it("names the unknown fixture rather than seeding an empty workspace", () => {
    expect(() => resolveFixture("absent", fixtures)).toThrow('Unknown fixture "absent"');
  });

  it("reports the cycle path instead of looping forever", () => {
    const circular = {
      one: { extends: "two", files: {} },
      two: { extends: "one", files: {} },
    };

    expect(() => resolveFixture("one", circular)).toThrow(
      "Circular fixture extends: one -> two -> one",
    );
  });
});

describe("expandResponseSugar", () => {
  it("expands `typeErrors: none` into the three fields a clean check returns", () => {
    expect(expandResponseSugar({ status: "success", typeErrors: "none" })).toEqual({
      status: "success",
      typeErrors: [],
      typeErrorCount: 0,
      typeErrorsTruncated: false,
    });
  });

  it("leaves a written-out typeErrors array alone", () => {
    const written = { status: "warn", typeErrors: [{ file: "a.ts" }], typeErrorCount: 1 };

    expect(expandResponseSugar(written)).toEqual(written);
  });

  it("leaves a response that never mentions typeErrors alone", () => {
    const written = { status: "error", error: "FILE_NOT_FOUND" };

    expect(expandResponseSugar(written)).toEqual(written);
  });
});
