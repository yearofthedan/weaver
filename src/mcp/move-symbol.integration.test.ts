import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { readFile } from "../__testHelpers__/helpers.js";
import { parseMcpResult, useMcpContext } from "../__testHelpers__/mcp-helpers.js";

describe("MCP transport — moveSymbol tool", () => {
  const { setup } = useMcpContext();

  it("moves a symbol end-to-end via MCP and updates import paths", async () => {
    const { dir, client } = await setup();

    expect(readFile(dir, "src/utils.ts")).toContain("greetUser");
    expect(readFile(dir, "src/main.ts")).toContain("./utils");

    const sourceFile = path.join(dir, "src/utils.ts");
    const destFile = path.join(dir, "src/helpers.ts");

    const resp = await client.request(1, "tools/call", {
      name: "moveSymbol",
      arguments: { sourceFile, symbolName: "greetUser", destFile },
    });

    const result = parseMcpResult(resp);

    expect(result.ok).toBe(true);

    // Symbol moved to dest file
    expect(readFile(dir, "src/helpers.ts")).toContain("greetUser");
    // Symbol removed from source file
    expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
    // main.ts import updated to point at helpers
    const mainContent = readFile(dir, "src/main.ts");
    expect(mainContent).toContain("./helpers");
    expect(mainContent).not.toContain("./utils");
  }, 60_000);
});
