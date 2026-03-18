import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { readFile } from "../../__testHelpers__/helpers.js";
import { parseMcpResult, useMcpContext } from "../../__testHelpers__/mcp-helpers.js";

describe("MCP transport — rename tool", () => {
  const { setup } = useMcpContext();

  it("renames a symbol end-to-end via MCP", async () => {
    const { dir, client } = await setup();

    expect(readFile(dir, "src/utils.ts")).toContain("greetUser");
    expect(readFile(dir, "src/main.ts")).toContain("greetUser");

    const resp = await client.request(1, "tools/call", {
      name: "rename",
      arguments: {
        file: path.join(dir, "src/utils.ts"),
        line: 1,
        col: 17,
        newName: "greetPerson",
      },
    });

    const result = parseMcpResult(resp);

    expect(result.ok).toBe(true);
    expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
    expect(readFile(dir, "src/utils.ts")).toContain("greetPerson");
    expect(readFile(dir, "src/main.ts")).not.toContain("greetUser");
    expect(readFile(dir, "src/main.ts")).toContain("greetPerson");
  }, 60_000);
});
