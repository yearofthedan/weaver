import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeRegistry } from "../../src/daemon/dispatcher.js";
import { TsProvider } from "../../src/providers/ts.js";
import { cleanup, copyFixture } from "../helpers.js";

describe("makeRegistry", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("returns an object with projectProvider and tsProvider functions", () => {
    const registry = makeRegistry("/any/file.ts");
    expect(typeof registry.projectProvider).toBe("function");
    expect(typeof registry.tsProvider).toBe("function");
  });

  it("tsProvider resolves to a TsProvider with LanguageProvider methods", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    const registry = makeRegistry(path.join(dir, "src/utils.ts"));
    const provider = await registry.tsProvider();
    expect(provider).toBeInstanceOf(TsProvider);
    expect(typeof provider.resolveOffset).toBe("function");
    expect(typeof provider.afterSymbolMove).toBe("function");
  }, 10_000);

  it("projectProvider resolves to a TsProvider for a TS-only project", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    const registry = makeRegistry(path.join(dir, "src/utils.ts"));
    const provider = await registry.projectProvider();
    expect(provider).toBeInstanceOf(TsProvider);
  }, 10_000);
});
