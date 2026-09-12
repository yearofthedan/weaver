// Renders a Stryker JSON report as a GitHub step summary.
//
// Distinguishes a run that produced a low score from one that never produced a
// report at all: the second is a broken run, and reporting it as a quality
// problem sends the reader looking for survivors that do not exist.
//
// Usage: node scripts/mutation-summary.mjs <report.json> <lane label>
import { readFileSync } from "node:fs";

const [reportPath, lane] = process.argv.slice(2);

/** Mutant statuses that represent a real verdict, and so belong in the denominator. */
const SCORED = new Set(["Killed", "Survived", "NoCoverage", "Timeout"]);
/** Stryker scores a timeout as killed, so the denominator treats it the same way. */
const KILLED = new Set(["Killed", "Timeout"]);

function render() {
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    return [
      `## ${lane} mutation run failed`,
      "",
      `No report at \`${reportPath}\` — the run did not complete, so there is no score to read.`,
      "",
      `\`\`\`\n${error.message}\n\`\`\``,
    ].join("\n");
  }

  const mutants = Object.values(report.files ?? {}).flatMap((file) => file.mutants ?? []);
  const scored = mutants.filter((m) => SCORED.has(m.status));
  if (scored.length === 0) {
    return `## ${lane} mutation run produced no scored mutants\n\nNothing was mutated — check the \`mutate\` scope.`;
  }

  const killed = scored.filter((m) => KILLED.has(m.status)).length;
  const timedOut = scored.filter((m) => m.status === "Timeout").length;
  const survived = scored.filter((m) => m.status === "Survived").length;
  const noCoverage = scored.filter((m) => m.status === "NoCoverage").length;
  const score = ((killed / scored.length) * 100).toFixed(2);

  const lines = [
    `## ${lane} mutation score: ${score}%`,
    "",
    "| Killed | of which timed out | Survived | No coverage | Scored |",
    "|---|---|---|---|---|",
    `| ${killed} | ${timedOut} | ${survived} | ${noCoverage} | ${scored.length} |`,
    "",
    "Scored against whatever the incremental cache did not already cover, so this is",
    "not comparable to a full-scope run. Download the report artifact for detail.",
  ];

  // A timeout counts as killed, so a run full of them reports a healthy score
  // while having evaluated far less than it appears to. Say so rather than
  // letting the headline number flatter the run.
  if (timedOut > killed / 4) {
    lines.push(
      "",
      `> ${timedOut} of ${killed} kills were timeouts. Those mutants were not`,
      "> meaningfully tested — treat the score as an upper bound.",
    );
  }

  return lines.join("\n");
}

console.log(render());
