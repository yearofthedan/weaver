import {
  DeleteFileArgsSchema,
  ExtractFunctionArgsSchema,
  FindReferencesArgsSchema,
  GetDefinitionArgsSchema,
  GetTypeErrorsArgsSchema,
  MoveArgsSchema,
  MoveDirectoryArgsSchema,
  MoveSymbolArgsSchema,
  RenameArgsSchema,
  ReplaceTextArgsSchema,
  SearchTextArgsSchema,
} from "../adapters/schema.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { extractFunction } from "../operations/extractFunction.js";
import { findReferences } from "../operations/findReferences.js";
import { getDefinition } from "../operations/getDefinition.js";
import { getTypeErrors, getTypeErrorsForFiles } from "../operations/getTypeErrors.js";
import { moveDirectory } from "../operations/moveDirectory.js";
import { moveFile } from "../operations/moveFile.js";
import { rename } from "../operations/rename.js";
import { replaceText } from "../operations/replaceText.js";
import { searchText } from "../operations/searchText.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { isWithinWorkspace, validateFilePath } from "../security.js";
import type { EngineRegistry } from "../ts-engine/types.js";
import { makeRegistry } from "./language-plugin-registry.js";

export { createVueLanguagePlugin } from "../plugins/vue/plugin.js";
export type { LanguagePlugin } from "../ts-engine/types.js";
export {
  clearLanguagePlugins,
  invalidateAll,
  invalidateFile,
  makeRegistry,
  registerLanguagePlugin,
} from "./language-plugin-registry.js";

// ─── Operation descriptor table ───────────────────────────────────────────

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
  /** Call the appropriate compiler method and return the raw result. */
  invoke(
    registry: EngineRegistry,
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
      const compiler = await registry.projectCompiler();
      const scope = new WorkspaceScope(workspace, new NodeFileSystem());
      return rename(compiler, file, line, col, newName, scope);
    },
  },

  moveFile: {
    pathParams: ["oldPath", "newPath"],
    schema: MoveArgsSchema,
    async invoke(registry, params, workspace) {
      const { oldPath, newPath } = params as { oldPath: string; newPath: string };
      const compiler = await registry.projectCompiler();
      const scope = new WorkspaceScope(workspace, new NodeFileSystem());
      return moveFile(compiler, oldPath, newPath, scope);
    },
  },

  moveDirectory: {
    pathParams: ["oldPath", "newPath"],
    schema: MoveDirectoryArgsSchema,
    async invoke(registry, params, workspace) {
      const { oldPath, newPath } = params as { oldPath: string; newPath: string };
      const compiler = await registry.projectCompiler();
      const scope = new WorkspaceScope(workspace, new NodeFileSystem());
      return moveDirectory(compiler, oldPath, newPath, scope);
    },
  },

  moveSymbol: {
    pathParams: ["sourceFile", "destFile"],
    schema: MoveSymbolArgsSchema,
    async invoke(registry, params, workspace) {
      const { sourceFile, symbolName, destFile, force } = params as {
        sourceFile: string;
        symbolName: string;
        destFile: string;
        force?: boolean;
      };
      const tsCompiler = await registry.tsCompiler();
      const projectCompiler = await registry.projectCompiler();
      const scope = new WorkspaceScope(workspace, new NodeFileSystem());
      const { moveSymbol } = await import("../operations/moveSymbol.js");
      return moveSymbol(tsCompiler, projectCompiler, sourceFile, symbolName, destFile, scope, {
        force,
      });
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
      const tsCompiler = await registry.tsCompiler();
      const scope = new WorkspaceScope(workspace, new NodeFileSystem());
      return extractFunction(
        tsCompiler,
        file,
        startLine,
        startCol,
        endLine,
        endCol,
        functionName,
        scope,
      );
    },
  },

  findReferences: {
    pathParams: ["file"],
    schema: FindReferencesArgsSchema,
    async invoke(registry, params) {
      const { file, line, col } = params as { file: string; line: number; col: number };
      const compiler = await registry.projectCompiler();
      return findReferences(compiler, file, line, col);
    },
  },

  getDefinition: {
    pathParams: ["file"],
    schema: GetDefinitionArgsSchema,
    async invoke(registry, params) {
      const { file, line, col } = params as { file: string; line: number; col: number };
      const compiler = await registry.projectCompiler();
      return getDefinition(compiler, file, line, col);
    },
  },

  getTypeErrors: {
    pathParams: [],
    schema: GetTypeErrorsArgsSchema,
    async invoke(registry, params, workspace) {
      const { file } = params as { file?: string };
      const tsCompiler = await registry.tsCompiler();
      const scope = new WorkspaceScope(workspace, new NodeFileSystem());
      return getTypeErrors(tsCompiler, file, scope);
    },
  },

  searchText: {
    pathParams: [],
    schema: SearchTextArgsSchema,
    async invoke(_registry, params, workspace) {
      const { pattern, glob, context, maxResults } = params as {
        pattern: string;
        glob?: string;
        context?: number;
        maxResults?: number;
      };
      const scope = new WorkspaceScope(workspace, new NodeFileSystem());
      return searchText(pattern, scope, { glob, context, maxResults });
    },
  },

  deleteFile: {
    pathParams: ["file"],
    schema: DeleteFileArgsSchema,
    async invoke(registry, params, workspace) {
      const { file } = params as { file: string };
      const tsCompiler = await registry.tsCompiler();
      const scope = new WorkspaceScope(workspace, new NodeFileSystem());
      const { deleteFile } = await import("../operations/deleteFile.js");
      return deleteFile(tsCompiler, file, scope);
    },
  },

  replaceText: {
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
      const scope = new WorkspaceScope(workspace, new NodeFileSystem());
      return replaceText(scope, { pattern, replacement, glob, edits });
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

  const parsed = descriptor.schema.safeParse(req.params);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("; ");
    return { ok: false, error: "VALIDATION_ERROR", message };
  }

  for (const paramKey of descriptor.pathParams) {
    const value = req.params[paramKey] as string;
    const pathResult = validateFilePath(value);
    if (!pathResult.ok) {
      return {
        ok: false,
        error: "INVALID_PATH",
        message:
          pathResult.reason === "CONTROL_CHARS"
            ? `path contains control characters: ${paramKey}`
            : `path contains URI fragment or query character: ${paramKey}`,
      };
    }
    if (!isWithinWorkspace(value, workspace)) {
      return {
        ok: false,
        error: "WORKSPACE_VIOLATION",
        message: `${paramKey} is outside the workspace: ${value}`,
      };
    }
  }

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
    const tsCompiler = await registry.tsCompiler();
    const diagnostics = getTypeErrorsForFiles(
      tsCompiler,
      result.filesModified as string[],
      new NodeFileSystem(),
    );
    result.typeErrors = diagnostics.typeErrors;
    result.typeErrorCount = diagnostics.typeErrorCount;
    result.typeErrorsTruncated = diagnostics.typeErrorsTruncated;
  }

  return { ok: true, ...result };
}
