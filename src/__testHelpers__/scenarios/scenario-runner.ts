import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { dispatchRequest } from "../../daemon/dispatcher.js";
import {
  type Effects,
  expandResponseSugar,
  resolveFixture,
  type Scenario,
  type ScenarioFile,
  scenarioFile,
} from "./scenario-schema.js";

export function loadScenarios(absPath: string): ScenarioFile {
  return scenarioFile.parse(parseYaml(fs.readFileSync(absPath, "utf8")));
}

type Tree = Record<string, string>;

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

function assertEffects(root: string, before: Tree, effects: Effects): void {
  const after = readTree(root);

  for (const [from, to] of Object.entries(effects.moved)) {
    expect(after[from], `${from} should have moved away`).toBeUndefined();
    expect(after[to], `${to} should exist, with content intact, after the move`).toBe(before[from]);
  }

  for (const [file, content] of Object.entries(effects.changed)) {
    expect(after[file], `${file} was listed as changed but is identical`).not.toBe(before[file]);
    expect(after[file], `${file} content`).toBe(content);
  }

  for (const file of effects.unchanged) {
    expect(before[file], `${file} should have existed beforehand`).toBeDefined();
    expect(after[file], `${file} should have been left alone`).toBe(before[file]);
  }

  const claimed = new Set([
    ...Object.keys(effects.moved),
    ...Object.values(effects.moved),
    ...Object.keys(effects.changed),
    ...effects.unchanged,
  ]);
  const unaccounted = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((file) => !claimed.has(file) && before[file] !== after[file])
    .sort();
  expect(unaccounted, "files changed without being named in `then.files`").toEqual([]);
}

/** Rewrite the temp root out of every path the response carries, at any depth. */
function scrubRoot(root: string, value: Record<string, unknown>): unknown {
  return JSON.parse(JSON.stringify(value).split(`${root}/`).join(""));
}

/**
 * Exact equality against the response a scenario documents, so a field appearing that the
 * file does not mention fails here — the one place per operation that has to be looked at
 * when the shape a consumer receives grows.
 */
function assertResponseMatches(
  root: string,
  written: Record<string, unknown>,
  actual: Record<string, unknown>,
): void {
  expect(scrubRoot(root, actual), "response").toEqual(expandResponseSugar(written));
}

/**
 * The expectation when a scenario states no response: the reported files agree with the
 * effect contract, nothing was skipped, and the touched files are type-clean.
 *
 * These are the dispatcher's envelope fields, carried by every method's response, so they
 * are asserted here rather than declared per file. Read without fallbacks, so a response
 * that stops carrying one fails instead of defaulting to the expected value.
 */
function assertDerivedResponse(
  root: string,
  actual: Record<string, unknown>,
  effects: Effects,
  sentParams: Record<string, unknown>,
): void {
  const scrubbed = scrubRoot(root, actual) as Record<string, unknown>;

  expect(scrubbed.status, "response.status").toBe("success");
  expect((scrubbed.filesModified as string[]).slice().sort(), "response.filesModified").toEqual(
    [...Object.keys(effects.changed), ...Object.values(effects.moved)].sort(),
  );
  expect(scrubbed.filesSkipped, "response.filesSkipped").toEqual([]);
  expect(scrubbed.typeErrors, "response.typeErrors").toEqual([]);
  expect(scrubbed.typeErrorCount, "response.typeErrorCount").toBe(0);
  expect(scrubbed.typeErrorsTruncated, "response.typeErrorsTruncated").toBe(false);

  // Path params are echoed back resolved; a mismatch means resolution went wrong.
  for (const [key, sent] of Object.entries(sentParams)) {
    if (key in scrubbed) {
      expect(scrubbed[key], `response.${key} should echo the request`).toEqual(
        typeof sent === "string" ? sent.replace(`${root}/`, "") : sent,
      );
    }
  }
}

export async function executeScenario(
  scenario: Scenario,
  file: ScenarioFile,
  root: string,
): Promise<void> {
  seed(root, resolveFixture(scenario.given, file.fixtures));
  const before = readTree(root);

  const [step] = scenario.when;
  const [method, rawParams] = Object.entries(step)[0];
  const params = resolveParams(root, rawParams);

  const result = (await dispatchRequest({ method, params }, root)) as Record<string, unknown>;

  assertEffects(root, before, scenario.then.files);

  if (scenario.then.response === undefined) {
    assertDerivedResponse(root, result, scenario.then.files, params);
  } else {
    assertResponseMatches(root, scenario.then.response, result);
  }
}
