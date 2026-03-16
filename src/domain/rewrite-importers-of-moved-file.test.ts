import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import {
  isCoexistingJsFile,
  rewriteImportersOfMovedFile,
  rewriteSpecifier,
} from "./rewrite-importers-of-moved-file.js";
import { WorkspaceScope } from "./workspace-scope.js";

const ROOT = "/project";

function makeScope(files: Record<string, string> = {}): WorkspaceScope {
  const vfs = new InMemoryFileSystem();
  for (const [filePath, content] of Object.entries(files)) {
    vfs.writeFile(filePath, content);
  }
  return new WorkspaceScope(ROOT, vfs);
}

describe("isCoexistingJsFile", () => {
  describe("JS-family extension detection", () => {
    it("returns false for a specifier without a JS-family extension", () => {
      const scope = makeScope({});
      expect(isCoexistingJsFile("./utils", "/project/src", scope)).toBe(false);
    });

    it("returns false for a .ts extension specifier (not JS-family)", () => {
      const scope = makeScope({ "/project/src/utils.ts": "export const x = 1;" });
      expect(isCoexistingJsFile("./utils.ts", "/project/src", scope)).toBe(false);
    });

    it("returns true when a .js specifier resolves to a real file", () => {
      const scope = makeScope({ "/project/src/utils.js": "export const x = 1;" });
      expect(isCoexistingJsFile("./utils.js", "/project/src", scope)).toBe(true);
    });

    it("returns false when a .js specifier does not resolve to a file", () => {
      const scope = makeScope({});
      expect(isCoexistingJsFile("./utils.js", "/project/src", scope)).toBe(false);
    });

    it("returns true when a .mjs specifier resolves to a real file", () => {
      const scope = makeScope({ "/project/src/utils.mjs": "export const x = 1;" });
      expect(isCoexistingJsFile("./utils.mjs", "/project/src", scope)).toBe(true);
    });
  });
});

describe("rewriteSpecifier", () => {
  describe("bare base match", () => {
    it("rewrites when specifier exactly matches relOldBase", () => {
      const scope = makeScope({});
      const result = rewriteSpecifier(
        "./old/utils",
        "./old/utils",
        "./new/utils",
        "/project/src",
        scope,
      );
      expect(result).toBe("./new/utils");
    });

    it("returns null when specifier does not match relOldBase", () => {
      const scope = makeScope({});
      const result = rewriteSpecifier(
        "./other/utils",
        "./old/utils",
        "./new/utils",
        "/project/src",
        scope,
      );
      expect(result).toBeNull();
    });
  });

  describe("JS-family extension variants", () => {
    it("rewrites a .js-suffixed specifier when no real .js file exists", () => {
      const scope = makeScope({});
      const result = rewriteSpecifier(
        "./old/utils.js",
        "./old/utils",
        "./new/utils",
        "/project/src",
        scope,
      );
      expect(result).toBe("./new/utils.js");
    });

    it("does not rewrite a .js-suffixed specifier when a real .js file exists", () => {
      const scope = makeScope({ "/project/src/old/utils.js": "export const x = 1;" });
      const result = rewriteSpecifier(
        "./old/utils.js",
        "./old/utils",
        "./new/utils",
        "/project/src",
        scope,
      );
      expect(result).toBeNull();
    });

    it("rewrites a .ts-suffixed specifier unconditionally", () => {
      const scope = makeScope({});
      const result = rewriteSpecifier(
        "./old/utils.ts",
        "./old/utils",
        "./new/utils",
        "/project/src",
        scope,
      );
      expect(result).toBe("./new/utils.ts");
    });

    it("rewrites a .jsx-suffixed specifier when no real .jsx file exists", () => {
      const scope = makeScope({});
      const result = rewriteSpecifier(
        "./old/utils.jsx",
        "./old/utils",
        "./new/utils",
        "/project/src",
        scope,
      );
      expect(result).toBe("./new/utils.jsx");
    });

    it("rewrites a .mjs-suffixed specifier when no real .mjs file exists", () => {
      const scope = makeScope({});
      const result = rewriteSpecifier(
        "./old/utils.mjs",
        "./old/utils",
        "./new/utils",
        "/project/src",
        scope,
      );
      expect(result).toBe("./new/utils.mjs");
    });

    it("rewrites a .cjs-suffixed specifier when no real .cjs file exists", () => {
      const scope = makeScope({});
      const result = rewriteSpecifier(
        "./old/utils.cjs",
        "./old/utils",
        "./new/utils",
        "/project/src",
        scope,
      );
      expect(result).toBe("./new/utils.cjs");
    });
  });

  describe("substring false positive guard", () => {
    it("does not match ./utils when moving ./my-utils", () => {
      const scope = makeScope({});
      const result = rewriteSpecifier(
        "./utils",
        "./my-utils",
        "./my-new-utils",
        "/project/src",
        scope,
      );
      expect(result).toBeNull();
    });
  });
});

describe("rewriteImportersOfMovedFile", () => {
  describe("basic import rewriting", () => {
    it("rewrites a bare specifier pointing at the old path", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { x } from "./old/utils";\n`,
      });
      rewriteImportersOfMovedFile("/project/src/old/utils.ts", "/project/src/new/utils.ts", scope, [
        "/project/src/consumer.ts",
      ]);
      const result = scope.fs.readFile("/project/src/consumer.ts");
      expect(result).toContain(`from "./new/utils"`);
      expect(result).not.toContain(`from "./old/utils"`);
    });

    it("rewrites a .js-extension specifier pointing at the old path", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { x } from "./old/utils.js";\n`,
      });
      rewriteImportersOfMovedFile("/project/src/old/utils.ts", "/project/src/new/utils.ts", scope, [
        "/project/src/consumer.ts",
      ]);
      const result = scope.fs.readFile("/project/src/consumer.ts");
      expect(result).toContain(`from "./new/utils.js"`);
      expect(result).not.toContain(`from "./old/utils.js"`);
    });

    it("rewrites re-export declarations", () => {
      const scope = makeScope({
        "/project/src/index.ts": `export { x } from "./old/utils";\n`,
      });
      rewriteImportersOfMovedFile("/project/src/old/utils.ts", "/project/src/new/utils.ts", scope, [
        "/project/src/index.ts",
      ]);
      const result = scope.fs.readFile("/project/src/index.ts");
      expect(result).toContain(`from "./new/utils"`);
      expect(result).not.toContain(`from "./old/utils"`);
    });

    it("leaves unrelated imports unchanged", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { x } from "./other/module";\n`,
      });
      rewriteImportersOfMovedFile("/project/src/old/utils.ts", "/project/src/new/utils.ts", scope, [
        "/project/src/consumer.ts",
      ]);
      const result = scope.fs.readFile("/project/src/consumer.ts");
      expect(result).toContain(`from "./other/module"`);
      expect(scope.modified).not.toContain("/project/src/consumer.ts");
    });
  });

  describe("alreadyModified skipping", () => {
    it("skips files already in scope.modified", () => {
      const original = `import { x } from "./old/utils";\n`;
      const scope = makeScope({
        "/project/src/consumer.ts": original,
      });
      scope.recordModified("/project/src/consumer.ts");
      rewriteImportersOfMovedFile("/project/src/old/utils.ts", "/project/src/new/utils.ts", scope, [
        "/project/src/consumer.ts",
      ]);
      expect(scope.fs.readFile("/project/src/consumer.ts")).toBe(original);
    });

    it("does not double-count a file as modified when it was already in scope.modified before the call", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { x } from "./old/utils";\n`,
      });
      scope.recordModified("/project/src/consumer.ts");
      rewriteImportersOfMovedFile("/project/src/old/utils.ts", "/project/src/new/utils.ts", scope, [
        "/project/src/consumer.ts",
      ]);
      // modified count should remain 1, not increase to 2
      expect(scope.modified.filter((f) => f === "/project/src/consumer.ts")).toHaveLength(1);
    });
  });

  describe("workspace boundary enforcement", () => {
    it("records files outside workspace as skipped", () => {
      const scope = makeScope({});
      rewriteImportersOfMovedFile("/project/src/old/utils.ts", "/project/src/new/utils.ts", scope, [
        "/outside/consumer.ts",
      ]);
      expect(scope.skipped).toContain("/outside/consumer.ts");
      expect(scope.modified).not.toContain("/outside/consumer.ts");
    });
  });

  describe("coexisting .js file guard", () => {
    it("does not rewrite a .js specifier when a real .js file exists at that path", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { x } from "./old/utils.js";\n`,
        "/project/src/old/utils.js": `export const x = 1;\n`,
      });
      rewriteImportersOfMovedFile("/project/src/old/utils.ts", "/project/src/new/utils.ts", scope, [
        "/project/src/consumer.ts",
      ]);
      const result = scope.fs.readFile("/project/src/consumer.ts");
      expect(result).toContain(`from "./old/utils.js"`);
      expect(result).not.toContain(`from "./new/utils.js"`);
    });
  });

  describe("scope tracking", () => {
    it("records modified file in scope.modified", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { x } from "./old/utils";\n`,
      });
      rewriteImportersOfMovedFile("/project/src/old/utils.ts", "/project/src/new/utils.ts", scope, [
        "/project/src/consumer.ts",
      ]);
      expect(scope.modified).toContain("/project/src/consumer.ts");
    });

    it("does not record a file as modified when no changes were made", () => {
      const scope = makeScope({
        "/project/src/consumer.ts": `import { x } from "./unrelated";\n`,
      });
      rewriteImportersOfMovedFile("/project/src/old/utils.ts", "/project/src/new/utils.ts", scope, [
        "/project/src/consumer.ts",
      ]);
      expect(scope.modified).not.toContain("/project/src/consumer.ts");
    });
  });

  describe("multiple files", () => {
    it("rewrites multiple importers in a single pass", () => {
      const scope = makeScope({
        "/project/src/a.ts": `import { x } from "./old/utils";\n`,
        "/project/src/b.ts": `import { x } from "./old/utils";\n`,
        "/project/src/c.ts": `import { x } from "./unrelated";\n`,
      });
      rewriteImportersOfMovedFile("/project/src/old/utils.ts", "/project/src/new/utils.ts", scope, [
        "/project/src/a.ts",
        "/project/src/b.ts",
        "/project/src/c.ts",
      ]);
      expect(scope.fs.readFile("/project/src/a.ts")).toContain(`from "./new/utils"`);
      expect(scope.fs.readFile("/project/src/b.ts")).toContain(`from "./new/utils"`);
      expect(scope.fs.readFile("/project/src/c.ts")).toContain(`from "./unrelated"`);
      expect(scope.modified).toContain("/project/src/a.ts");
      expect(scope.modified).toContain("/project/src/b.ts");
      expect(scope.modified).not.toContain("/project/src/c.ts");
    });
  });

  describe("cross-directory specifier resolution", () => {
    it("rewrites specifier from a deeper-nested file relative to the old path", () => {
      // Consumer is in tests/, moved file goes from src/composables/ to src/utils/
      const scope = makeScope({
        "/project/tests/unit/counter.test.ts": `import { x } from "../../src/composables/useCounter";\n`,
      });
      rewriteImportersOfMovedFile(
        "/project/src/composables/useCounter.ts",
        "/project/src/utils/useCounter.ts",
        scope,
        ["/project/tests/unit/counter.test.ts"],
      );
      const result = scope.fs.readFile("/project/tests/unit/counter.test.ts");
      expect(result).toContain(`from "../../src/utils/useCounter"`);
      expect(result).not.toContain(`from "../../src/composables/useCounter"`);
    });
  });
});
