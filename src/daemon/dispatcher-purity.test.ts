import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const DISPATCHER_FILE = path.resolve(import.meta.dirname, "dispatcher.ts");

describe("dispatcher filesystem sharing", () => {
  it("dispatcher.ts constructs no NodeFileSystem of its own — every operation uses the shared instance", () => {
    const content = fs.readFileSync(DISPATCHER_FILE, "utf8");

    expect(content).not.toContain("new NodeFileSystem(");
  });
});
