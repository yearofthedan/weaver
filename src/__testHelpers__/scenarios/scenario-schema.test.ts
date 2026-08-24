import { describe, expect, it } from "vitest";
import { expandResponseSugar, resolveFixture, scenarioFile } from "./scenario-schema.js";

const minimalScenario = {
  name: "a scenario",
  given: { files: { "a.ts": "" } },
  when: [{ moveFile: { oldPath: "a.ts", newPath: "b.ts" } }],
  // biome-ignore lint/suspicious/noThenProperty: `then` is the Given/When/Then vocabulary of the scenario format under test; this object is a scenario, never awaited, so being thenable is inert.
  then: { response: { status: "success" } },
};

describe("scenarioFile", () => {
  it("rejects a file with no scenarios, so an empty suite cannot pass silently", () => {
    expect(() => scenarioFile.parse({ scenarios: [] })).toThrow();
  });

  it("rejects a step declaring two methods, naming both", () => {
    const parse = () =>
      scenarioFile.parse({
        scenarios: [{ ...minimalScenario, when: [{ moveFile: {}, renameSymbol: {} }] }],
      });

    expect(parse).toThrow(/exactly one method, got: moveFile, renameSymbol/);
  });

  it("rejects more than one step while multi-step support is undecided", () => {
    const parse = () =>
      scenarioFile.parse({
        scenarios: [{ ...minimalScenario, when: [{ moveFile: {} }, { moveFile: {} }] }],
      });

    expect(parse).toThrow();
  });

  it("defaults the effect contract, so omitting `files` claims nothing changed", () => {
    const file = scenarioFile.parse({ scenarios: [minimalScenario] });

    expect(file.scenarios[0].then.files).toEqual({ moved: {}, changed: {}, unchanged: [] });
  });

  it("rejects a scenario that states no response, the contract a consumer receives", () => {
    const { then: _omitted, ...noResponse } = minimalScenario;

    expect(() => scenarioFile.parse({ scenarios: [noResponse] })).toThrow();
  });

  it("drops keys the schema does not declare instead of rejecting them", () => {
    const file = scenarioFile.parse({
      scenarios: [{ ...minimalScenario, invented: "ignored" }],
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
