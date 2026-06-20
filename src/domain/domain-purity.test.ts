import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const DOMAIN_DIR = path.resolve(import.meta.dirname, ".");
const FORBIDDEN = ["node:fs", "node:os"];

describe("domain layer I/O purity", () => {
  it("no domain source file imports node:fs or node:os", () => {
    const sourceFiles = fs
      .readdirSync(DOMAIN_DIR)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => path.join(DOMAIN_DIR, f));

    const violations: string[] = [];

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, "utf8");
      for (const forbidden of FORBIDDEN) {
        if (content.includes(`"${forbidden}"`) || content.includes(`'${forbidden}'`)) {
          violations.push(`${path.relative(DOMAIN_DIR, file)} imports ${forbidden}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
