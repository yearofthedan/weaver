import * as path from "node:path";
import * as ts from "typescript";
import type { RefactorEngine } from "../engines/types.js";
import { findTsConfigForFile } from "../engines/project.js";

let tsEngine: import("../engines/ts-engine.js").TsEngine | undefined;
let vueEngine: import("../engines/vue-engine.js").VueEngine | undefined;

/**
 * Returns true if the project directory (rooted at the tsconfig location)
 * contains any .vue files. This is the signal that VueEngine should be used
 * for all operations, regardless of starting file extension.
 * Cached per project root for the process lifetime.
 */
const vueProjectCache = new Map<string, boolean>();

function isVueProject(tsConfigPath: string): boolean {
  const projectRoot = path.dirname(tsConfigPath);

  if (vueProjectCache.has(projectRoot)) {
    return vueProjectCache.get(projectRoot)!;
  }

  const vueFiles = ts.sys.readDirectory(projectRoot, [".vue"], [], [], 1000);
  const hasVue = vueFiles.length > 0;
  vueProjectCache.set(projectRoot, hasVue);
  return hasVue;
}

export async function getEngine(filePath: string): Promise<RefactorEngine> {
  const tsConfigPath = findTsConfigForFile(filePath);

  if (tsConfigPath && isVueProject(tsConfigPath)) {
    if (!vueEngine) {
      const { VueEngine } = await import("../engines/vue-engine.js");
      vueEngine = new VueEngine();
    }
    return vueEngine;
  }

  if (!tsEngine) {
    const { TsEngine } = await import("../engines/ts-engine.js");
    tsEngine = new TsEngine();
  }
  return tsEngine;
}
