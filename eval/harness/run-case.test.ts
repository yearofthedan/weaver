import { describe, expect, it } from "vitest";
import type { FrontLoadedCase } from "../cases/cases.js";
import type { ModelStep } from "./agentic-loop.js";
import type { ModelResponse, ToolCall } from "./call-model.js";
import { runCaseTrials, runTrial } from "./run-case.js";

const CASE: FrontLoadedCase = {
  name: "run-case-test",
  exposure: "front-loaded",
  task: "rename `userId` to `accountId`",
  momentumTurns: 0,
  expect: { command: "rename", keyArgs: { newName: "accountId" } },
};

const tc = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
  name,
  arguments: args,
});

/** A model that always emits the expected weaver command, matching on every call. */
const alwaysMatches: ModelStep = async () => ({
  toolCalls: [tc("bash", { command: `weaver rename '{"newName":"accountId"}'` })],
  text: "",
});

/** A model that names a tool the front-loaded lane never declares, so it never matches or hard-fails. */
const neverMatches: ModelStep = async () => ({
  toolCalls: [tc("Grep", { pattern: "userId" })],
  text: "",
});

/** A model that reaches for a different mutating weaver subcommand, hard-failing the trial. */
const hardFailsImmediately: ModelStep = async () => ({
  toolCalls: [tc("bash", { command: `weaver move-file '{"oldPath":"a.ts"}'` })],
  text: "",
});

function countingStep(response: ModelResponse): { step: ModelStep; callCount: () => number } {
  let calls = 0;
  const step: ModelStep = async () => {
    calls += 1;
    return response;
  };
  return { step, callCount: () => calls };
}

describe("runTrial", () => {
  it("drives the case's assembled config through the agentic loop and reports a match", async () => {
    const result = await runTrial(CASE, alwaysMatches);
    expect(result.matched).toBe(true);
    expect(result.matchedAtStep).toBe(1);
  });

  it("reports no match when the model never reaches the expected command", async () => {
    const result = await runTrial(CASE, neverMatches);
    expect(result.matched).toBe(false);
  });

  it("stops at the case's step budget rather than the model's own default", async () => {
    const { step, callCount } = countingStep({
      toolCalls: [tc("Grep", { pattern: "userId" })],
      text: "",
    });
    await runTrial(CASE, step);
    expect(callCount()).toBe(3); // FRONT_LOADED_MAX_STEPS
  });
});

describe("runCaseTrials", () => {
  it("stops at the base trial count when every trial passes", async () => {
    const { step, callCount } = countingStep({
      toolCalls: [tc("bash", { command: `weaver rename '{"newName":"accountId"}'` })],
      text: "",
    });
    const run = await runCaseTrials(CASE, step, 3);

    expect(run.trials).toHaveLength(3);
    expect(run.trials.every((t) => t.matched)).toBe(true);
    expect(callCount()).toBe(3);
  });

  it("escalates to the total escalated trial count when the base result falls below the floor", async () => {
    const run = await runCaseTrials(CASE, neverMatches, 3);

    expect(run.trials).toHaveLength(6); // ESCALATED_TRIALS
    expect(run.trials.every((t) => !t.matched)).toBe(true);
  });

  it("still escalates when the base result clears the 2/3 floor but is not a clean sweep", async () => {
    let calls = 0;
    const step: ModelStep = async () => {
      calls += 1;
      // 2 of 3 base trials match — clears the floor, but one trial still failed.
      const matched = calls <= 2;
      return {
        toolCalls: [
          tc("bash", {
            command: matched
              ? `weaver rename '{"newName":"accountId"}'`
              : `weaver rename '{"newName":"wrong"}'`,
          }),
        ],
        text: "",
      };
    };

    const run = await runCaseTrials(CASE, step, 3);
    expect(run.trials).toHaveLength(6); // ESCALATED_TRIALS
  });

  it("reports hardFailed true when any trial hard-fails on a mutating competitor", async () => {
    const run = await runCaseTrials(CASE, hardFailsImmediately, 3);
    expect(run.hardFailed).toBe(true);
    // A hard fail stops the trial at step 1, but does not itself stop escalation —
    // it never matches, so the case still runs to the escalated total.
    expect(run.trials).toHaveLength(6);
  });

  it("reports hardFailed true when only one of several trials hard-fails", async () => {
    let calls = 0;
    const step: ModelStep = async () => {
      calls += 1;
      const command =
        calls === 1
          ? `weaver move-file '{"oldPath":"a.ts"}'`
          : `weaver rename '{"newName":"accountId"}'`;
      return { toolCalls: [tc("bash", { command })], text: "" };
    };

    // The base 3 trials are 1 hard fail + 2 matches — clears the floor but
    // isn't a clean sweep, so the case escalates to the full 6.
    const run = await runCaseTrials(CASE, step, 3);
    expect(run.trials).toHaveLength(6);
    expect(run.trials.filter((t) => t.failedAtStep !== undefined)).toHaveLength(1);
    expect(run.trials.filter((t) => t.matched)).toHaveLength(5);
    expect(run.hardFailed).toBe(true);
  });

  it("reports hardFailed false when no trial hard-fails", async () => {
    const { step } = countingStep({
      toolCalls: [tc("bash", { command: `weaver rename '{"newName":"accountId"}'` })],
      text: "",
    });
    const run = await runCaseTrials(CASE, step, 3);
    expect(run.hardFailed).toBe(false);
  });
});
