import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { type DispatchResponse, dispatchRequest, pathParamsFor } from "../../daemon/dispatcher.js";
import { resolveRelativePaths } from "../../utils/resolve-path-params.js";
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

function parseScenarios(text: string): ScenarioFile {
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
 * Rewrite the temp root out of every path the response carries, at any depth.
 *
 * A resolved module path (e.g. a `node_modules` package reached through TypeScript's own
 * module resolution, which realpaths what it finds) can come back under the *resolved* form
 * of a symlinked temp dir — `/private/var/folders/...` rather than the `/var/folders/...`
 * `os.tmpdir()` hands back on macOS — so both forms of the root are stripped.
 */
function scrubRoot(root: string, value: DispatchResponse): unknown {
  const realRoot = fs.realpathSync(root);
  // Strip the resolved form first: it contains the unresolved form as a substring
  // whenever the two differ, so stripping in the other order leaves a dangling
  // "/private" (or equivalent) prefix behind instead of removing it.
  return JSON.parse(
    JSON.stringify(value).split(`${realRoot}/`).join("").split(`${root}/`).join(""),
  );
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
    // Copy before resolving: the helper mutates in place, and `rawParams` belongs to the
    // parsed scenario file shared by every test in the suite.
    const params = { ...rawParams };
    resolveRelativePaths(params, pathParamsFor(method), root);
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
