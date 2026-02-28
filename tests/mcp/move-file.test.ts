import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { readFile } from "../helpers.js";
import { parseMcpResult, useMcpContext } from "../mcp-helpers.js";

describe("MCP transport — moveFile tool", () => {
  const { setup } = useMcpContext();

  it("moves a file end-to-end via MCP and updates import paths", async () => {
    const { dir, client } = await setup("multi-importer");

    expect(readFile(dir, "src/featureA.ts")).toContain("./utils");
    expect(readFile(dir, "src/featureB.ts")).toContain("./utils");

    const oldPath = path.join(dir, "src/utils.ts");
    const newPath = path.join(dir, "src/helpers.ts");

    const resp = await client.request(1, "tools/call", {
      name: "moveFile",
      arguments: { oldPath, newPath },
    });

    const result = parseMcpResult(resp);

    expect(result.ok).toBe(true);
    expect(readFile(dir, "src/featureA.ts")).not.toContain("./utils");
    expect(readFile(dir, "src/featureA.ts")).toContain("./helpers");
    expect(readFile(dir, "src/featureB.ts")).not.toContain("./utils");
    expect(readFile(dir, "src/featureB.ts")).toContain("./helpers");
  }, 60_000);
});
