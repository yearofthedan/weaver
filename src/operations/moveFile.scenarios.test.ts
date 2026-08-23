import { describe } from "vitest";
import { fixtureTest as test } from "../__testHelpers__/helpers.js";
import { executeScenario, loadScenarios } from "../__testHelpers__/scenarios/scenario-runner.js";

const file = loadScenarios(new URL("./moveFile.scenarios.yaml", import.meta.url).pathname);

describe("moveFile scenarios", () => {
  for (const scenario of file.scenarios) {
    test(scenario.name, async ({ dir }) => {
      await executeScenario(scenario, file, dir);
    });
  }
});
