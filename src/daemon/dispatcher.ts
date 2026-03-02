import { extractFunction } from "../operations/extractFunction.js";
import { findReferences } from "../operations/findReferences.js";
import { getDefinition } from "../operations/getDefinition.js";
import { getTypeErrors, getTypeErrorsForFiles } from "../operations/getTypeErrors.js";
import { moveFile } from "../operations/moveFile.js";
import { rename } from "../operations/rename.js";
import { replaceText } from "../operations/replaceText.js";
import { searchText } from "../operations/searchText.js";
import {
  ExtractFunctionArgsSchema,
  FindReferencesArgsSchema,
  GetDefinitionArgsSchema,
  GetTypeErrorsArgsSchema,
  MoveArgsSchema,
  MoveSymbolArgsSchema,
  RenameArgsSchema,
  ReplaceTextArgsSchema,
  SearchTextArgsSchema,
} from "../schema.js";
import { isWithinWorkspace } from "../security.js";
import type { LanguageProvider, ProviderRegistry } from "../types.js";
import { findTsConfigForFile, isVueProject } from "../utils/ts-project.js";

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

interface OperationDescriptor {
  /** Param keys that hold file paths requiring workspace validation. */
  pathParams: string[];
  /** Zod schema used to validate incoming params at the socket boundary. */
  schema: {
    safeParse(
      data: unknown,
    ):
      | { success: true; data: Record<string, unknown> }
      | { success: false; error: { issues: Array<{ message: string }> } };
  };
  /** Call the appropriate provider method and return the raw result. */
  invoke(
    registry: ProviderRegistry,
    params: Record<string, unknown>,
    workspace: string,
  ): Promise<unknown>;
}

const OPERATIONS: Record<string, OperationDescriptor> = {
  rename: {
    pathParams: ["file"],
    schema: RenameArgsSchema,
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
  },

  moveFile: {
    pathParams: ["oldPath", "newPath"],
    schema: MoveArgsSchema,
    async invoke(registry, params, workspace) {
      const { oldPath, newPath } = params as { oldPath: string; newPath: string };
      const provider = await registry.projectProvider();
      return moveFile(provider, oldPath, newPath, workspace);
    },
  },

  moveSymbol: {
    pathParams: ["sourceFile", "destFile"],
    schema: MoveSymbolArgsSchema,
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
  },

  extractFunction: {
    pathParams: ["file"],
    schema: ExtractFunctionArgsSchema,
    async invoke(registry, params, workspace) {
      const { file, startLine, startCol, endLine, endCol, functionName } = params as {
        file: string;
        startLine: number;
        startCol: number;
        endLine: number;
        endCol: number;
        functionName: string;
      };
      const tsProvider = await registry.tsProvider();
      return extractFunction(
        tsProvider,
        file,
        startLine,
        startCol,
        endLine,
        endCol,
        functionName,
        workspace,
      );
    },
  },

  findReferences: {
    pathParams: ["file"],
    schema: FindReferencesArgsSchema,
    async invoke(registry, params) {
      const { file, line, col } = params as { file: string; line: number; col: number };
      const provider = await registry.projectProvider();
      return findReferences(provider, file, line, col);
    },
  },

  getDefinition: {
    pathParams: ["file"],
    schema: GetDefinitionArgsSchema,
    async invoke(registry, params) {
      const { file, line, col } = params as { file: string; line: number; col: number };
      const provider = await registry.projectProvider();
      return getDefinition(provider, file, line, col);
    },
  },

  getTypeErrors: {
    pathParams: [],
    schema: GetTypeErrorsArgsSchema,
    async invoke(registry, params, workspace) {
      const { file } = params as { file?: string };
      const tsProvider = await registry.tsProvider();
      return getTypeErrors(tsProvider, file, workspace);
    },
  },

  searchText: {
    // No path params — operates on the whole workspace, not a specific file.
    // Workspace boundary is enforced by the operation itself (files are walked
    // from the workspace root and sensitive files are skipped).
    pathParams: [],
    schema: SearchTextArgsSchema,
    async invoke(_registry, params, workspace) {
      const { pattern, glob, context, maxResults } = params as {
        pattern: string;
        glob?: string;
        context?: number;
        maxResults?: number;
      };
      return searchText(pattern, workspace, { glob, context, maxResults });
    },
  },

  replaceText: {
    // No path params — workspace boundary is enforced by the operation itself.
    pathParams: [],
    schema: ReplaceTextArgsSchema,
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
  },
};

export async function dispatchRequest(
  req: { method: string; params: Record<string, unknown> },
  workspace: string,
): Promise<object> {
  const descriptor = OPERATIONS[req.method];
  if (!descriptor) {
    return { ok: false, error: "UNKNOWN_METHOD", message: `Unknown method: ${req.method}` };
  }

  // Validate params against the operation's schema before touching any files
  const parsed = descriptor.schema.safeParse(req.params);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("; ");
    return { ok: false, error: "VALIDATION_ERROR", message };
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

  const result = (await descriptor.invoke(registry, parsed.data, workspace)) as Record<
    string,
    unknown
  >;

  if (
    parsed.data.checkTypeErrors !== false &&
    Array.isArray(result.filesModified) &&
    (result.filesModified as string[]).length > 0
  ) {
    const tsProvider = await registry.tsProvider();
    const diagnostics = getTypeErrorsForFiles(tsProvider, result.filesModified as string[]);
    result.typeErrors = diagnostics.typeErrors;
    result.typeErrorCount = diagnostics.typeErrorCount;
    result.typeErrorsTruncated = diagnostics.typeErrorsTruncated;
  }

  return { ok: true, ...result };
}
