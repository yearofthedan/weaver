import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type ConventionIssue, validateMcpConfigText } from "./agent-conventions.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIG_FILES = [".mcp.json", ".cursor/mcp.json"] as const;

function readAndValidate(relativeFile: string): ConventionIssue[] {
  const abs = path.join(PROJECT_ROOT, relativeFile);
  if (!fs.existsSync(abs)) return [{ file: relativeFile, message: "file is missing" }];
  const content = fs.readFileSync(abs, "utf8");
  return validateMcpConfigText(relativeFile, content);
}

function main(): void {
  const issues = CONFIG_FILES.flatMap((file) => readAndValidate(file));
  if (issues.length === 0) {
    process.stdout.write(`agent:check passed (${CONFIG_FILES.length} files)\n`);
    return;
  }

  process.stderr.write("agent:check failed\n");
  for (const entry of issues) {
    process.stderr.write(`- ${entry.file}: ${entry.message}\n`);
  }
  process.exitCode = 1;
}

main();
