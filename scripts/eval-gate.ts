/**
 * Runs the gate lane once per roster model and fails the command if any
 * model's run failed. A thin spawning adapter over the pure plan builder in
 * `eval/harness/gate-plan.ts` — no gating logic lives here.
 *
 * Usage: pnpm eval:gate [-t <case-regex>]
 * WEAVER_EVAL_TRIALS, if set, overrides every model's roster trial count.
 */
import { spawn } from "node:child_process";
import { GATING_MODELS } from "../eval/harness/config.js";
import { buildGatePlans, extractRunCost, type GateRunPlan } from "../eval/harness/gate-plan.js";

interface GateRunResult {
  plan: GateRunPlan;
  exitCode: number;
  cost: number | undefined;
}

function runPlan(plan: GateRunPlan): Promise<GateRunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    const child = spawn("pnpm", plan.argv, {
      env: {
        ...process.env,
        WEAVER_EVAL_MODEL: plan.modelId,
        WEAVER_EVAL_TRIALS: String(plan.trials),
      },
      stdio: ["ignore", "pipe", "inherit"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      stdout += chunk.toString();
    });

    child.on("error", (err) => {
      console.error(`Failed to start "pnpm ${plan.argv.join(" ")}": ${err.message}`);
      resolve({ plan, exitCode: 1, cost: undefined });
    });

    child.on("close", (code) => {
      resolve({ plan, exitCode: code ?? 1, cost: extractRunCost(stdout) });
    });
  });
}

function formatCost(cost: number | undefined): string {
  return cost === undefined ? "cost unknown" : `$${cost.toFixed(4)}`;
}

async function main(): Promise<void> {
  const extraArgv = process.argv.slice(2);
  const plans = buildGatePlans(GATING_MODELS, {
    trialsOverride: process.env.WEAVER_EVAL_TRIALS,
    extraArgv,
  });

  const results: GateRunResult[] = [];
  for (const plan of plans) {
    console.log(`\n=== eval:gate — ${plan.modelId} (trials ${plan.trials}) ===`);
    results.push(await runPlan(plan));
  }

  console.log("\n=== eval:gate summary ===");
  for (const result of results) {
    const status = result.exitCode === 0 ? "PASS" : "FAIL";
    console.log(`${status}  ${result.plan.modelId}  ${formatCost(result.cost)}`);
  }

  const anyFailed = results.some((result) => result.exitCode !== 0);
  console.log(anyFailed ? "\neval:gate — FAILED" : "\neval:gate — PASSED");
  process.exitCode = anyFailed ? 1 : 0;
}

main();
