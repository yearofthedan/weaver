import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMcpResult, useMcpContext } from "../mcp-helpers.js";

describe("MCP transport — getDefinition tool", () => {
  const { setup } = useMcpContext();

  it("resolves the definition of a symbol end-to-end via MCP", async () => {
    const { dir, client } = await setup();

    // Call getDefinition on the greetUser call site in main.ts (line 3, col 13)
    const resp = await client.request(1, "tools/call", {
      name: "getDefinition",
      arguments: {
        file: path.join(dir, "src/main.ts"),
        line: 3,
        col: 13,
      },
    });

    const result = parseMcpResult(resp);

    expect(result.ok).toBe(true);
    expect(result.symbolName).toBe("greetUser");
    expect((result.definitions as { file: string }[]).length).toBeGreaterThanOrEqual(1);
    // Definition must point back to utils.ts
    expect(
      (result.definitions as { file: string }[]).some((d) => d.file.endsWith("utils.ts")),
    ).toBe(true);
  }, 60_000);
});
