import { findTsConfigForFile, isVueProject } from "../engines/ts/project.js";
import type {
  FindReferencesResult,
  GetDefinitionResult,
  MoveResult,
  MoveSymbolResult,
  RefactorEngine,
  RenameResult,
} from "../engines/types.js";
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

// ─── Operation descriptor table ───────────────────────────────────────────

interface OperationDescriptor {
  /** Param keys that hold file paths requiring workspace validation. */
  pathParams: string[];
  /** Call the appropriate engine method and return the raw result. */
  invoke(
    engine: RefactorEngine,
    params: Record<string, unknown>,
    workspace: string,
  ): Promise<unknown>;
  /** Format the raw result into the final response object. */
  format(result: unknown): object;
}

const OPERATIONS: Record<string, OperationDescriptor> = {
  rename: {
    pathParams: ["file"],
    invoke(engine, params, workspace) {
      const { file, line, col, newName } = params as {
        file: string;
        line: number;
        col: number;
        newName: string;
      };
      return engine.rename(file, line, col, newName, workspace);
    },
    format(result) {
      const r = result as RenameResult;
      const plural = r.locationCount === 1 ? "location" : "locations";
      const fileCount = r.filesModified.length;
      return {
        ok: true,
        filesModified: r.filesModified,
        filesSkipped: r.filesSkipped,
        message: `Renamed '${r.symbolName}' to '${r.newName}' in ${r.locationCount} ${plural} across ${fileCount} ${fileCount === 1 ? "file" : "files"}`,
      };
    },
  },

  move: {
    pathParams: ["oldPath", "newPath"],
    invoke(engine, params, workspace) {
      const { oldPath, newPath } = params as { oldPath: string; newPath: string };
      return engine.moveFile(oldPath, newPath, workspace);
    },
    format(result) {
      const r = result as MoveResult;
      const fileCount = r.filesModified.length;
      return {
        ok: true,
        filesModified: r.filesModified,
        filesSkipped: r.filesSkipped,
        message: `Moved '${r.oldPath}' to '${r.newPath}', updated imports in ${fileCount} ${fileCount === 1 ? "file" : "files"}`,
      };
    },
  },

  moveSymbol: {
    pathParams: ["sourceFile", "destFile"],
    invoke(engine, params, workspace) {
      const { sourceFile, symbolName, destFile } = params as {
        sourceFile: string;
        symbolName: string;
        destFile: string;
      };
      return engine.moveSymbol(sourceFile, symbolName, destFile, workspace);
    },
    format(result) {
      const r = result as MoveSymbolResult;
      const fileCount = r.filesModified.length;
      return {
        ok: true,
        filesModified: r.filesModified,
        filesSkipped: r.filesSkipped,
        message: `Moved '${r.symbolName}' from '${r.sourceFile}' to '${r.destFile}', updated imports in ${fileCount} ${fileCount === 1 ? "file" : "files"}`,
      };
    },
  },

  findReferences: {
    pathParams: ["file"],
    invoke(engine, params) {
      const { file, line, col } = params as { file: string; line: number; col: number };
      return engine.findReferences(file, line, col);
    },
    format(result) {
      const r = result as FindReferencesResult;
      const count = r.references.length;
      return {
        ok: true,
        symbolName: r.symbolName,
        references: r.references,
        message: `Found ${count} ${count === 1 ? "reference" : "references"} to '${r.symbolName}'`,
      };
    },
  },

  getDefinition: {
    pathParams: ["file"],
    invoke(engine, params) {
      const { file, line, col } = params as { file: string; line: number; col: number };
      return engine.getDefinition(file, line, col);
    },
    format(result) {
      const r = result as GetDefinitionResult;
      const count = r.definitions.length;
      return {
        ok: true,
        symbolName: r.symbolName,
        definitions: r.definitions,
        message: `Found ${count} ${count === 1 ? "definition" : "definitions"} for '${r.symbolName}'`,
      };
    },
  },
};

// ─── Dispatcher ────────────────────────────────────────────────────────────

export async function dispatchRequest(
  req: { method: string; params: Record<string, unknown> },
  workspace: string,
): Promise<object> {
  const descriptor = OPERATIONS[req.method];
  if (!descriptor) {
    return { ok: false, error: "UNKNOWN_METHOD", message: `Unknown method: ${req.method}` };
  }

  // Validate all path params are within the workspace
  for (const paramKey of descriptor.pathParams) {
    const value = req.params[paramKey] as string;
    if (!isWithinWorkspace(value, workspace)) {
      return {
        ok: false,
        error: "WORKSPACE_VIOLATION",
        message: `${paramKey} is outside the workspace: ${value}`,
      };
    }
  }

  // The first path param determines which engine to use
  const enginePath = req.params[descriptor.pathParams[0]] as string;
  const engine = await getEngine(enginePath);
  const result = await descriptor.invoke(engine, req.params, workspace);
  return descriptor.format(result);
}
