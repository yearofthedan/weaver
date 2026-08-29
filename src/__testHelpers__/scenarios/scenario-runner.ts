import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { type DispatchResponse, dispatchRequest } from "../../daemon/dispatcher.js";
import {
  assertEffects,
  assertResponseMatches,
  assertStepSucceeded,
  describeFailure,
  type Tree,
} from "./scenario-oracle.js";
import {
  resolveFixture,
  type Scenario,
  type ScenarioFile,
  scenarioFile,
} from "./scenario-schema.js";

export function parseScenarios(text: string): ScenarioFile {
  return scenarioFile.parse(parseYaml(text));
}

export function loadScenarios(absPath: string): ScenarioFile {
  return parseScenarios(fs.readFileSync(absPath, "utf8"));
}

function readTree(root: string): Tree {
  const tree: Tree = {};
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    tree[path.relative(root, abs)] = fs.readFileSync(abs, "utf8");
  }
  return tree;
}

function seed(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/**
 * Mirrors the CLI's own relative-path resolution. It resolves every relative string
 * param, where the CLI resolves only those a method declares as paths — good enough
 * while moveFile is the only method here, wrong for a method taking a literal string.
 */
function resolveParams(root: string, params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      typeof value === "string" && !path.isAbsolute(value) ? path.join(root, value) : value,
    ]),
  );
}

/** Rewrite the temp root out of every path the response carries, at any depth. */
function scrubRoot(root: string, value: DispatchResponse): unknown {
  return JSON.parse(JSON.stringify(value).split(`${root}/`).join(""));
}

export async function executeScenario(
  scenario: Scenario,
  file: ScenarioFile,
  root: string,
): Promise<void> {
  seed(root, resolveFixture(scenario.given, file.fixtures));
  const before = readTree(root);

  // `when` is `.min(1)`, so the loop below always assigns before anything reads this.
  let last!: DispatchResponse;
  for (const step of scenario.when) {
    const [method, rawParams] = Object.entries(step)[0];
    const params = resolveParams(root, rawParams);
    last = await dispatchRequest({ method, params }, root);
    // A stated response says what to expect, failure included; a sequence has no such claim.
    if (scenario.then.response === undefined) {
      assertStepSucceeded(method, last);
    }
  }

  try {
    assertEffects(before, readTree(root), scenario.then.files);

    if (scenario.then.response !== undefined) {
      assertResponseMatches(scenario.then.response, scrubRoot(root, last));
    }
  } catch (error) {
    throw describeFailure(error, scenario.description);
  }
}
