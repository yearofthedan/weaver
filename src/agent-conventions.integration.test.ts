import { describe, expect, it } from "vitest";
import { validateLightBridgeServerConfig } from "../scripts/agent-conventions.js";

describe("validateLightBridgeServerConfig", () => {
  it("accepts the portable committed config pattern", () => {
    const issues = validateLightBridgeServerConfig(".mcp.json", {
      mcpServers: {
        "light-bridge": {
          type: "stdio",
          command: "pnpm",
          args: ["exec", "tsx", "src/cli.ts", "serve", "--workspace", "."],
        },
      },
    });
    expect(issues).toEqual([]);
  });

  it("rejects host-specific absolute workspace paths", () => {
    const issues = validateLightBridgeServerConfig(".mcp.json", {
      mcpServers: {
        "light-bridge": {
          type: "stdio",
          command: "pnpm",
          args: ["exec", "tsx", "src/cli.ts", "serve", "--workspace", "/workspace"],
        },
      },
    });
    expect(issues.some((issue) => issue.message.includes("use --workspace ."))).toBe(true);
  });

  it("rejects /workspace and /workspaces hardcoded args", () => {
    const issues = validateLightBridgeServerConfig(".mcp.json", {
      mcpServers: {
        "light-bridge": {
          type: "stdio",
          command: "node",
          args: ["/workspaces/light-bridge/dist/cli.js", "serve", "--workspace", "."],
        },
      },
    });
    expect(issues.some((issue) => issue.message.includes("hardcoded host path"))).toBe(true);
  });

  it("rejects absolute command paths", () => {
    const issues = validateLightBridgeServerConfig(".mcp.json", {
      mcpServers: {
        "light-bridge": {
          type: "stdio",
          command: "/usr/local/bin/light-bridge",
          args: ["serve", "--workspace", "."],
        },
      },
    });
    expect(issues.some((issue) => issue.message.includes("must not be absolute"))).toBe(true);
  });

  it("requires a workspace flag", () => {
    const issues = validateLightBridgeServerConfig(".mcp.json", {
      mcpServers: {
        "light-bridge": {
          type: "stdio",
          command: "pnpm",
          args: ["exec", "tsx", "src/cli.ts", "serve"],
        },
      },
    });
    expect(issues.some((issue) => issue.message.includes("--workspace"))).toBe(true);
  });
});
