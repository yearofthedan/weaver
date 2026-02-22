import { findTsConfigForFile, isVueProject } from "../engines/ts/project.js";
import type { RefactorEngine } from "../engines/types.js";
import { isWithinWorkspace } from "../workspace.js";

let tsEngine: import("../engines/ts/engine.js").TsEngine | undefined;
let vueEngine: import("../engines/vue/engine.js").VueEngine | undefined;

async function getEngine(filePath: string): Promise<RefactorEngine> {
  const tsConfigPath = findTsConfigForFile(filePath);
  if (tsConfigPath && isVueProject(tsConfigPath)) {
    if (!vueEngine) {
      const { VueEngine } = await import("../engines/vue/engine.js");
      vueEngine = new VueEngine();
    }
    return vueEngine;
  }
  if (!tsEngine) {
    const { TsEngine } = await import("../engines/ts/engine.js");
    tsEngine = new TsEngine();
  }
  return tsEngine;
}

export async function warmupEngine(filePath: string): Promise<void> {
  await getEngine(filePath);
}

export async function dispatchRequest(
  req: { method: string; params: Record<string, unknown> },
  workspace: string,
): Promise<object> {
  if (req.method === "rename") {
    const { file, line, col, newName } = req.params as {
      file: string;
      line: number;
      col: number;
      newName: string;
    };
    if (!isWithinWorkspace(file, workspace)) {
      return {
        ok: false,
        error: "WORKSPACE_VIOLATION",
        message: `File path is outside the workspace: ${file}`,
      };
    }
    const engine = await getEngine(file);
    const result = await engine.rename(file, line, col, newName, workspace);
    const plural = result.locationCount === 1 ? "location" : "locations";
    const fileCount = result.filesModified.length;
    return {
      ok: true,
      filesModified: result.filesModified,
      filesSkipped: result.filesSkipped,
      message: `Renamed '${result.symbolName}' to '${result.newName}' in ${result.locationCount} ${plural} across ${fileCount} ${fileCount === 1 ? "file" : "files"}`,
    };
  }

  if (req.method === "move") {
    const { oldPath, newPath } = req.params as { oldPath: string; newPath: string };
    if (!isWithinWorkspace(oldPath, workspace)) {
      return {
        ok: false,
        error: "WORKSPACE_VIOLATION",
        message: `oldPath is outside the workspace: ${oldPath}`,
      };
    }
    if (!isWithinWorkspace(newPath, workspace)) {
      return {
        ok: false,
        error: "WORKSPACE_VIOLATION",
        message: `newPath is outside the workspace: ${newPath}`,
      };
    }
    const engine = await getEngine(oldPath);
    const result = await engine.moveFile(oldPath, newPath, workspace);
    const fileCount = result.filesModified.length;
    return {
      ok: true,
      filesModified: result.filesModified,
      filesSkipped: result.filesSkipped,
      message: `Moved '${oldPath}' to '${newPath}', updated imports in ${fileCount} ${fileCount === 1 ? "file" : "files"}`,
    };
  }

  if (req.method === "moveSymbol") {
    const { sourceFile, symbolName, destFile } = req.params as {
      sourceFile: string;
      symbolName: string;
      destFile: string;
    };
    if (!isWithinWorkspace(sourceFile, workspace)) {
      return {
        ok: false,
        error: "WORKSPACE_VIOLATION",
        message: `sourceFile is outside the workspace: ${sourceFile}`,
      };
    }
    if (!isWithinWorkspace(destFile, workspace)) {
      return {
        ok: false,
        error: "WORKSPACE_VIOLATION",
        message: `destFile is outside the workspace: ${destFile}`,
      };
    }
    const engine = await getEngine(sourceFile);
    const result = await engine.moveSymbol(sourceFile, symbolName, destFile, workspace);
    const fileCount = result.filesModified.length;
    return {
      ok: true,
      filesModified: result.filesModified,
      filesSkipped: result.filesSkipped,
      message: `Moved '${symbolName}' from '${result.sourceFile}' to '${result.destFile}', updated imports in ${fileCount} ${fileCount === 1 ? "file" : "files"}`,
    };
  }

  return { ok: false, error: "UNKNOWN_METHOD", message: `Unknown method: ${req.method}` };
}
