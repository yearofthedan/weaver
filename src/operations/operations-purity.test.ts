import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

// The operations core reads files only through the injected `FileSystem` port.
// The compiler adapters (`ts-engine/`, `plugins/vue/`) and `utils/ts-project.ts`
// are deliberately out of scope — they legitimately touch real disk — so this
// guard covers only `src/operations/**` and the shared `utils/file-walk.ts`.
const OPERATIONS_DIR = path.resolve(import.meta.dirname, ".");
const FILE_WALK = path.resolve(import.meta.dirname, "../utils/file-walk.ts");
const FORBIDDEN = "node:fs";

function sourceFilesIn(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(dir, f));
}

describe("operations core I/O purity", () => {
  it("no operations source file nor file-walk.ts imports node:fs", () => {
    const files = [...sourceFilesIn(OPERATIONS_DIR), FILE_WALK];

    const violations: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes(`"${FORBIDDEN}"`) || content.includes(`'${FORBIDDEN}'`)) {
        violations.push(`${path.relative(OPERATIONS_DIR, file)} imports ${FORBIDDEN}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
