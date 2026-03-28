import * as path from "node:path";

export interface ConventionIssue {
  file: string;
  message: string;
}

interface StdioServerConfig {
  type?: unknown;
  command?: unknown;
  args?: unknown;
}

interface McpConfig {
  mcpServers?: Record<string, StdioServerConfig>;
}

function issue(file: string, message: string): ConventionIssue {
  return { file, message };
}

function isHardcodedHostPath(value: string): boolean {
  return /^\/workspace(\/|$)/.test(value) || /^\/workspaces(\/|$)/.test(value);
}

export function validateLightBridgeServerConfig(
  file: string,
  config: McpConfig,
): ConventionIssue[] {
  const issues: ConventionIssue[] = [];
  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    return [issue(file, "missing top-level mcpServers object")];
  }

  const server = config.mcpServers["weaver"];
  if (!server || typeof server !== "object") {
    return [issue(file, "missing mcpServers.weaver entry")];
  }

  if (server.type !== "stdio") {
    issues.push(issue(file, 'mcpServers.weaver.type must be "stdio"'));
  }

  if (typeof server.command !== "string" || server.command.length === 0) {
    issues.push(issue(file, "mcpServers.weaver.command must be a non-empty string"));
  } else if (path.isAbsolute(server.command)) {
    issues.push(issue(file, "mcpServers.weaver.command must not be absolute"));
  } else if (isHardcodedHostPath(server.command)) {
    issues.push(issue(file, "mcpServers.weaver.command contains hardcoded host path"));
  }

  if (!Array.isArray(server.args) || !server.args.every((v) => typeof v === "string")) {
    issues.push(issue(file, "mcpServers.weaver.args must be an array of strings"));
    return issues;
  }

  for (const arg of server.args) {
    if (isHardcodedHostPath(arg)) {
      issues.push(issue(file, "mcpServers.weaver.args contains hardcoded host path"));
    }
  }

  if (!server.args.includes("serve")) {
    issues.push(issue(file, 'mcpServers.weaver.args must include "serve"'));
  }

  const workspaceFlagIdx = server.args.indexOf("--workspace");
  if (workspaceFlagIdx === -1) {
    issues.push(issue(file, 'mcpServers.weaver.args must include "--workspace"'));
  } else {
    const workspaceValue = server.args[workspaceFlagIdx + 1];
    if (workspaceValue !== ".") {
      issues.push(issue(file, 'mcpServers.weaver.args should use --workspace .'));
    }
  }

  return issues;
}

export function validateMcpConfigText(file: string, content: string): ConventionIssue[] {
  try {
    const parsed = JSON.parse(content) as McpConfig;
    return validateLightBridgeServerConfig(file, parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [issue(file, `invalid JSON: ${message}`)];
  }
}
