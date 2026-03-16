import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMcpResult, useMcpContext } from "../__testHelpers__/mcp-helpers.js";

describe("MCP transport — findReferences tool", () => {
  const { setup } = useMcpContext();

  it("finds references to a symbol end-to-end via MCP", async () => {
    const { dir, client } = await setup();

    const resp = await client.request(1, "tools/call", {
      name: "findReferences",
      arguments: {
        file: path.join(dir, "src/utils.ts"),
        line: 1,
        col: 17,
      },
    });

    const result = parseMcpResult(resp);

    expect(result.ok).toBe(true);
    expect(result.symbolName).toBe("greetUser");
    expect((result.references as { file: string }[]).length).toBeGreaterThanOrEqual(2);
    expect((result.references as { file: string }[]).some((r) => r.file.endsWith("utils.ts"))).toBe(
      true,
    );
    expect((result.references as { file: string }[]).some((r) => r.file.endsWith("main.ts"))).toBe(
      true,
    );
  }, 60_000);
});
