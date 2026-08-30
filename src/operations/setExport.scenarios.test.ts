import { fileURLToPath } from "node:url";
import { describe } from "vitest";
import { fixtureTest as test } from "../__testHelpers__/helpers.js";
import { executeScenario, loadScenarios } from "../__testHelpers__/scenarios/scenario-runner.js";

const file = loadScenarios(fileURLToPath(new URL("./setExport.scenarios.yaml", import.meta.url)));

describe("setExport scenarios", () => {
  for (const scenario of file.scenarios) {
    test(scenario.name, async ({ dir }) => {
      await executeScenario(scenario, file, dir);
    });
  }
});
