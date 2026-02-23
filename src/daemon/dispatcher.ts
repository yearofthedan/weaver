import { findReferences } from "../operations/findReferences.js";
import { getDefinition } from "../operations/getDefinition.js";
import { moveFile } from "../operations/moveFile.js";
import { rename } from "../operations/rename.js";
import { replaceText } from "../operations/replaceText.js";
import { searchText } from "../operations/searchText.js";
import { isWithinWorkspace } from "../security.js";
import type {
  FindReferencesResult,
  GetDefinitionResult,
  LanguageProvider,
  MoveResult,
  MoveSymbolResult,
  ProviderRegistry,
  RenameResult,
  ReplaceTextResult,
  SearchTextResult,
} from "../types.js";
import { findTsConfigForFile, isVueProject } from "../utils/ts-project.js";

// ─── Provider singletons ───────────────────────────────────────────────────
// Lazy-loaded and cached for the daemon lifetime. Providers hold the stateful
// project graphs (ts-morph Projects, Volar services) — engines are thin wrappers.

let tsProviderSingleton: import("../providers/ts.js").TsProvider | undefined;
let volarProviderSingleton: import("../providers/volar.js").VolarProvider | undefined;

async function getTsProvider(): Promise<import("../providers/ts.js").TsProvider> {
  if (!tsProviderSingleton) {
    const { TsProvider } = await import("../providers/ts.js");
    tsProviderSingleton = new TsProvider();
  }
  return tsProviderSingleton;
}

async function getVolarProvider(): Promise<import("../providers/volar.js").VolarProvider> {
  if (!volarProviderSingleton) {
    const { VolarProvider } = await import("../providers/volar.js");
    volarProviderSingleton = new VolarProvider();
  }
  return volarProviderSingleton;
}

/**
 * Create a `ProviderRegistry` scoped to the project containing `filePath`.
 * `projectProvider` returns TsProvider or VolarProvider based on project type.
 * `tsProvider` always returns TsProvider for AST-level operations (e.g. moveSymbol).
 */
export function makeRegistry(filePath: string): ProviderRegistry {
  return {
    async projectProvider(): Promise<LanguageProvider> {
      const tsConfigPath = findTsConfigForFile(filePath);
      if (tsConfigPath && isVueProject(tsConfigPath)) {
        return getVolarProvider();
      }
      return getTsProvider();
    },
    async tsProvider() {
      return getTsProvider();
    },
  };
}

/**
 * Refresh a single file in whichever provider(s) are loaded.
 * Called by the watcher on `change` events — cheaper than full rebuild.
 */
export function invalidateFile(filePath: string): void {
  tsProviderSingleton?.refreshFile(filePath);
  volarProviderSingleton?.invalidateService(filePath);
}

/**
 * Drop all loaded providers so they rebuild lazily on the next request.
 * Called by the watcher on `add` and `unlink` events — structural changes
 * that require the full project graph to be refreshed.
 */
export function invalidateAll(): void {
  tsProviderSingleton = undefined;
  volarProviderSingleton = undefined;
}

// ─── Operation descriptor table ───────────────────────────────────────────

interface OperationDescriptor {
  /** Param keys that hold file paths requiring workspace validation. */
  pathParams: string[];
  /** Call the appropriate provider method and return the raw result. */
  invoke(
    registry: ProviderRegistry,
    params: Record<string, unknown>,
    workspace: string,
  ): Promise<unknown>;
  /** Format the raw result into the final response object. */
  format(result: unknown): object;
}

const OPERATIONS: Record<string, OperationDescriptor> = {
  rename: {
    pathParams: ["file"],
    async invoke(registry, params, workspace) {
      const { file, line, col, newName } = params as {
        file: string;
        line: number;
        col: number;
        newName: string;
      };
      const provider = await registry.projectProvider();
      return rename(provider, file, line, col, newName, workspace);
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

  moveFile: {
    pathParams: ["oldPath", "newPath"],
    async invoke(registry, params, workspace) {
      const { oldPath, newPath } = params as { oldPath: string; newPath: string };
      const provider = await registry.projectProvider();
      return moveFile(provider, oldPath, newPath, workspace);
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
    async invoke(registry, params, workspace) {
      const { sourceFile, symbolName, destFile } = params as {
        sourceFile: string;
        symbolName: string;
        destFile: string;
      };
      const tsProvider = await registry.tsProvider();
      const projectProvider = await registry.projectProvider();
      const { moveSymbol } = await import("../operations/moveSymbol.js");
      return moveSymbol(tsProvider, projectProvider, sourceFile, symbolName, destFile, workspace);
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
    async invoke(registry, params) {
      const { file, line, col } = params as { file: string; line: number; col: number };
      const provider = await registry.projectProvider();
      return findReferences(provider, file, line, col);
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
    async invoke(registry, params) {
      const { file, line, col } = params as { file: string; line: number; col: number };
      const provider = await registry.projectProvider();
      return getDefinition(provider, file, line, col);
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

  searchText: {
    // No path params — operates on the whole workspace, not a specific file.
    // Workspace boundary is enforced by the operation itself (files are walked
    // from the workspace root and sensitive files are skipped).
    pathParams: [],
    async invoke(_registry, params, workspace) {
      const { pattern, glob, context, maxResults } = params as {
        pattern: string;
        glob?: string;
        context?: number;
        maxResults?: number;
      };
      return searchText(pattern, workspace, { glob, context, maxResults });
    },
    format(result) {
      const r = result as SearchTextResult;
      const count = r.matches.length;
      return {
        ok: true,
        matches: r.matches,
        truncated: r.truncated,
        message: `Found ${count} ${count === 1 ? "match" : "matches"}${r.truncated ? " (truncated)" : ""}`,
      };
    },
  },

  replaceText: {
    // No path params — workspace boundary is enforced by the operation itself.
    pathParams: [],
    async invoke(_registry, params, workspace) {
      const { pattern, replacement, glob, edits } = params as {
        pattern?: string;
        replacement?: string;
        glob?: string;
        edits?: Array<{
          file: string;
          line: number;
          col: number;
          oldText: string;
          newText: string;
        }>;
      };
      return replaceText(workspace, { pattern, replacement, glob, edits });
    },
    format(result) {
      const r = result as ReplaceTextResult;
      const fileCount = r.filesModified.length;
      return {
        ok: true,
        filesModified: r.filesModified,
        replacementCount: r.replacementCount,
        message: `Replaced ${r.replacementCount} ${r.replacementCount === 1 ? "occurrence" : "occurrences"} across ${fileCount} ${fileCount === 1 ? "file" : "files"}`,
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

  // Operations with path params use the first param to select the right provider
  // (e.g. which tsconfig covers that file). Operations with no path params
  // (searchText, replaceText) receive a stub registry — they don't use it.
  const registry =
    descriptor.pathParams.length > 0
      ? makeRegistry(req.params[descriptor.pathParams[0]] as string)
      : makeRegistry(workspace);

  const result = await descriptor.invoke(registry, req.params, workspace);
  return descriptor.format(result);
}
