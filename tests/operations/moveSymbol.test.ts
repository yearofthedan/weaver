import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { moveSymbol } from "../../src/operations/moveSymbol.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";
import { makeMockProvider } from "../providers/__helpers__/mock-provider.js";

function makeMockTsProvider(overrides: Record<string, unknown> = {}) {
  return {
    moveSymbol: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Create a temporary directory with a real source file so assertFileExists passes.
 * Returns the dir, source path, dest path, and a scope rooted at the dir.
 */
function makeRealScope() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-movesymbol-unit-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const source = path.join(dir, "src/utils.ts");
  const dest = path.join(dir, "src/helpers.ts");
  fs.writeFileSync(source, "export function greetUser(name: string): string { return name; }\n");
  const scope = new WorkspaceScope(dir, new NodeFileSystem());
  return { dir, source, dest, scope };
}

const SYMBOL = "greetUser";

describe("moveSymbol operation (thin orchestrator)", () => {
  const dirs: string[] = [];
  let dir: string;
  let source: string;
  let dest: string;
  let scope: WorkspaceScope;

  beforeEach(() => {
    ({ dir, source, dest, scope } = makeRealScope());
    dirs.push(dir);
  });

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  describe("orchestrator delegates to tsProvider", () => {
    it("calls tsProvider.moveSymbol with resolved absolute paths, symbol, scope, and options", async () => {
      const tsProvider = makeMockTsProvider();
      const projectProvider = makeMockProvider();

      await moveSymbol(tsProvider as never, projectProvider, source, SYMBOL, dest, scope);

      expect(tsProvider.moveSymbol).toHaveBeenCalledWith(
        path.resolve(source),
        SYMBOL,
        path.resolve(dest),
        scope,
        undefined,
      );
    });

    it("forwards options to tsProvider.moveSymbol", async () => {
      const tsProvider = makeMockTsProvider();
      const projectProvider = makeMockProvider();
      const opts = { force: true };

      await moveSymbol(tsProvider as never, projectProvider, source, SYMBOL, dest, scope, opts);

      expect(tsProvider.moveSymbol).toHaveBeenCalledWith(
        path.resolve(source),
        SYMBOL,
        path.resolve(dest),
        scope,
        opts,
      );
    });
  });

  describe("after-hook result merging", () => {
    it("merges modified files from afterSymbolMove into scope", async () => {
      const extraFile = path.join(dir, "src/extra.ts");
      const tsProvider = makeMockTsProvider();
      const projectProvider = makeMockProvider({
        afterSymbolMove: vi.fn().mockResolvedValue({ modified: [extraFile], skipped: [] }),
      });

      const result = await moveSymbol(
        tsProvider as never,
        projectProvider,
        source,
        SYMBOL,
        dest,
        scope,
      );

      expect(result.filesModified).toContain(extraFile);
    });

    it("merges skipped files from afterSymbolMove into scope", async () => {
      const skippedFile = "/outside/workspace/file.vue";
      const tsProvider = makeMockTsProvider();
      const projectProvider = makeMockProvider({
        afterSymbolMove: vi.fn().mockResolvedValue({ modified: [], skipped: [skippedFile] }),
      });

      const result = await moveSymbol(
        tsProvider as never,
        projectProvider,
        source,
        SYMBOL,
        dest,
        scope,
      );

      expect(result.filesSkipped).toContain(skippedFile);
    });

    it("calls afterSymbolMove with absSource, symbol, absDest, scope.root, and already-modified set", async () => {
      const capturedSource = source;
      const tsProvider = makeMockTsProvider({
        moveSymbol: vi
          .fn()
          .mockImplementation((_src: string, _sym: string, _dst: string, s: WorkspaceScope) => {
            s.recordModified(capturedSource);
          }),
      });
      const projectProvider = makeMockProvider();

      await moveSymbol(tsProvider as never, projectProvider, source, SYMBOL, dest, scope);

      expect(projectProvider.afterSymbolMove).toHaveBeenCalledWith(
        path.resolve(source),
        SYMBOL,
        path.resolve(dest),
        dir,
        new Set([source]),
      );
    });
  });

  describe("return shape", () => {
    it("returns correct filesModified, filesSkipped, symbolName, sourceFile, and destFile", async () => {
      const capturedSource = source;
      const capturedDest = dest;
      const tsProvider = makeMockTsProvider({
        moveSymbol: vi
          .fn()
          .mockImplementation((_src: string, _sym: string, _dst: string, s: WorkspaceScope) => {
            s.recordModified(capturedSource);
            s.recordModified(capturedDest);
          }),
      });
      const projectProvider = makeMockProvider();

      const result = await moveSymbol(
        tsProvider as never,
        projectProvider,
        source,
        SYMBOL,
        dest,
        scope,
      );

      expect(result.symbolName).toBe(SYMBOL);
      expect(result.sourceFile).toBe(path.resolve(source));
      expect(result.destFile).toBe(path.resolve(dest));
      expect(result.filesModified).toContain(source);
      expect(result.filesModified).toContain(dest);
      expect(result.filesSkipped).toEqual([]);
    });
  });

  describe("assertFileExists", () => {
    it("throws FILE_NOT_FOUND when the source file does not exist", async () => {
      const tsProvider = makeMockTsProvider();
      const projectProvider = makeMockProvider();
      const missingSource = path.join(dir, "src/doesNotExist.ts");

      await expect(
        moveSymbol(tsProvider as never, projectProvider, missingSource, SYMBOL, dest, scope),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });
  });
});
