import {
  DeleteFileArgsSchema,
  ExtractFunctionArgsSchema,
  FindImportersArgsSchema,
  FindReferencesArgsSchema,
  GetDefinitionArgsSchema,
  GetTypeErrorsArgsSchema,
  MoveArgsSchema,
  MoveDirectoryArgsSchema,
  MoveSymbolArgsSchema,
  RenameArgsSchema,
  ReplaceTextArgsSchema,
  SearchTextArgsSchema,
  SetExportArgsSchema,
} from "../adapters/schema.js";
import { EngineError, type ErrorCode } from "../domain/errors.js";
import { validateFilePath } from "../domain/security.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { extractFunction } from "../operations/extractFunction.js";
import { findImporters } from "../operations/findImporters.js";
import { findReferences } from "../operations/findReferences.js";
import { getDefinition } from "../operations/getDefinition.js";
import { getTypeErrors } from "../operations/getTypeErrors.js";
import { moveDirectory } from "../operations/moveDirectory.js";
import { moveFile } from "../operations/moveFile.js";
import { rename } from "../operations/rename.js";
import { replaceText } from "../operations/replaceText.js";
import { searchText } from "../operations/searchText.js";
import { setExport } from "../operations/setExport.js";
import type { EngineRegistry } from "../ts-engine/types.js";
import { declaredPathValues, isTopLevelPathParam } from "../utils/resolve-path-params.js";
import { resetDiscoveryCaches } from "../utils/ts-project.js";
import { makeRegistry, refreshWrittenFile } from "./language-plugin-registry.js";
import { getTypeErrorsForFiles } from "./post-write-diagnostics.js";
import { drainPendingMutations, getSharedFileSystem } from "./self-write-state.js";

/**
 * Every dispatched operation shares this instance rather than constructing
 * its own, so a write one operation makes is visible — through the same
 * object — to every `WorkspaceScope` built for the requests that follow.
 * Mirrors the `defaultFs` precedent in `daemon.ts`.
 */
const defaultFs = getSharedFileSystem();

export { createVueLanguagePlugin } from "../plugins/vue/plugin.js";
export type { LanguagePlugin } from "../ts-engine/types.js";
export {
  clearLanguagePlugins,
  invalidateAll,
  invalidateFile,
  makeRegistry,
  registerLanguagePlugin,
} from "./language-plugin-registry.js";
export { shouldSuppressSelfWrite } from "./self-write-state.js";

// ─── Operation descriptor table ───────────────────────────────────────────

interface OperationDescriptor {
  /** Param keys that hold file paths requiring workspace validation. */
  pathParams: string[];
  /**
   * Name of a param that, when present, names a tsconfig directly rather than a file to
   * discover one from — engine selection must consult it as-is instead of walking up from
   * `pathParams[0]`. Only `getTypeErrors`'s `tsconfig` needs this today; it also must exist
   * (and not be a directory) before it's handed to engine selection, since that's a raw
   * filesystem read rather than a discovery walk that tolerates a miss.
   */
  tsConfigParam?: string;
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
      const engine = await registry.projectEngine();
      const scope = new WorkspaceScope(workspace, defaultFs);
      return rename(engine, file, line, col, newName, scope);
    },
  },

  moveFile: {
    pathParams: ["oldPath", "newPath"],
    schema: MoveArgsSchema,
    async invoke(registry, params, workspace) {
      const { oldPath, newPath } = params as { oldPath: string; newPath: string };
      const engine = await registry.projectEngine();
      const scope = new WorkspaceScope(workspace, defaultFs);
      return moveFile(engine, oldPath, newPath, scope);
    },
  },

  moveDirectory: {
    pathParams: ["oldPath", "newPath"],
    schema: MoveDirectoryArgsSchema,
    async invoke(registry, params, workspace) {
      const { oldPath, newPath } = params as { oldPath: string; newPath: string };
      const engine = await registry.projectEngine();
      const scope = new WorkspaceScope(workspace, defaultFs);
      return moveDirectory(engine, oldPath, newPath, scope);
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
      const engine = await registry.projectEngine();
      const scope = new WorkspaceScope(workspace, defaultFs);
      const { moveSymbol } = await import("../operations/moveSymbol.js");
      return moveSymbol(engine, sourceFile, symbolName, destFile, scope, { force });
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
      const engine = await registry.projectEngine();
      const scope = new WorkspaceScope(workspace, defaultFs);
      return extractFunction(
        engine,
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

  setExport: {
    pathParams: ["file"],
    schema: SetExportArgsSchema,
    async invoke(registry, params, workspace) {
      const { file, symbolName, exported } = params as {
        file: string;
        symbolName: string;
        exported: boolean;
      };
      const engine = await registry.projectEngine();
      const scope = new WorkspaceScope(workspace, defaultFs);
      return setExport(engine, file, symbolName, exported, scope);
    },
  },

  findImporters: {
    pathParams: ["file"],
    schema: FindImportersArgsSchema,
    async invoke(registry, params) {
      const { file } = params as { file: string };
      const engine = await registry.projectEngine();
      return findImporters(engine, file, defaultFs);
    },
  },

  findReferences: {
    pathParams: ["file"],
    schema: FindReferencesArgsSchema,
    async invoke(registry, params) {
      const { file, line, col } = params as { file: string; line: number; col: number };
      const engine = await registry.projectEngine();
      return findReferences(engine, file, line, col, defaultFs);
    },
  },

  getDefinition: {
    pathParams: ["file"],
    schema: GetDefinitionArgsSchema,
    async invoke(registry, params) {
      const { file, line, col } = params as { file: string; line: number; col: number };
      const engine = await registry.projectEngine();
      return getDefinition(engine, file, line, col, defaultFs);
    },
  },

  getTypeErrors: {
    pathParams: ["file", "tsconfig"],
    tsConfigParam: "tsconfig",
    schema: GetTypeErrorsArgsSchema,
    async invoke(registry, params, workspace) {
      const { file, tsconfig } = params as { file?: string; tsconfig?: string };
      const engine = await registry.projectEngine();
      const scope = new WorkspaceScope(workspace, defaultFs);
      return getTypeErrors(engine, file, scope, tsconfig);
    },
  },

  searchText: {
    pathParams: [],
    schema: SearchTextArgsSchema,
    async invoke(_registry, params, workspace) {
      const { pattern, glob, excludeGlob, context, maxResults } = params as {
        pattern: string;
        glob?: string;
        excludeGlob?: string;
        context?: number;
        maxResults?: number;
      };
      const scope = new WorkspaceScope(workspace, defaultFs);
      return searchText(pattern, scope, { glob, excludeGlob, context, maxResults });
    },
  },

  deleteFile: {
    pathParams: ["file"],
    schema: DeleteFileArgsSchema,
    async invoke(registry, params, workspace) {
      const { file } = params as { file: string };
      const engine = await registry.projectEngine();
      const scope = new WorkspaceScope(workspace, defaultFs);
      const { deleteFile } = await import("../operations/deleteFile.js");
      return deleteFile(engine, file, scope);
    },
  },

  replaceText: {
    pathParams: ["edits[].file"],
    schema: ReplaceTextArgsSchema,
    async invoke(_registry, params, workspace) {
      const { pattern, replacement, glob, excludeGlob, edits } = params as {
        pattern?: string;
        replacement?: string;
        glob?: string;
        excludeGlob?: string;
        edits?: Array<{
          file: string;
          line: number;
          col: number;
          oldText: string;
          newText: string;
        }>;
      };
      const scope = new WorkspaceScope(workspace, defaultFs);
      return replaceText(scope, { pattern, replacement, glob, excludeGlob, edits });
    },
  },
};

/** Canonical list of dispatchable operation names — the single source of truth. */
export const OPERATION_NAMES: string[] = Object.keys(OPERATIONS);

/** The param keys a method declares as file paths; empty for methods with none. */
export function pathParamsFor(method: string): string[] {
  return OPERATIONS[method]?.pathParams ?? [];
}

// ─── Response types ────────────────────────────────────────────────────────

export type DispatchError = {
  status: "error";
  error: ErrorCode;
  message: string;
  /** Frame lines only, present exclusively on INTERNAL_ERROR. */
  stack?: string;
};

export type DispatchResponse =
  | ({ status: "success" | "warn" } & Record<string, unknown>)
  | DispatchError;

/**
 * Strip the workspace prefix from absolute paths in a stack trace so that
 * responses are portable and don't leak the full host path.
 *
 * `workspace` always arrives resolved (validateWorkspace runs path.resolve and
 * rejects "/"), so it never carries a trailing slash to normalise away.
 */
function stripWorkspacePrefix(stack: string, workspace: string): string {
  return stack.replaceAll(`${workspace}/`, "");
}

/** Frame lines only (drops the leading `Name: message` line), capped and workspace-stripped. */
function formatStack(stack: string, workspace: string): string {
  const frames = stack.split("\n").slice(1, 11);
  return stripWorkspacePrefix(frames.join("\n"), workspace);
}

function toDispatchError(err: unknown, method: string, workspace: string): DispatchError {
  if (EngineError.is(err)) {
    return { status: "error", error: err.code, message: err.message };
  }
  if (err instanceof Error) {
    return {
      status: "error",
      error: "INTERNAL_ERROR",
      message: `${err.name} during '${method}': ${err.message}`,
      ...(err.stack ? { stack: formatStack(err.stack, workspace) } : {}),
    };
  }
  return { status: "error", error: "INTERNAL_ERROR", message: String(err) };
}

// ─── Dispatcher ────────────────────────────────────────────────────────────

export async function dispatchRequest(
  req: { method: string; params: Record<string, unknown> },
  workspace: string,
  /**
   * Invoked once the request has been dispatched, whatever its outcome. The
   * daemon passes its idle timer's `reset`, so the countdown measures the gap
   * between finishing one request and starting the next.
   */
  onActivity?: () => void,
): Promise<DispatchResponse> {
  try {
    // Fresh per dispatch so a tsconfig.json or the workspace's first .vue file added
    // since the last request is picked up before engine selection or project discovery.
    resetDiscoveryCaches();

    const descriptor = OPERATIONS[req.method];
    if (!descriptor) {
      return {
        status: "error" as const,
        error: "UNKNOWN_METHOD",
        message: `Unknown method: ${req.method}`,
      };
    }

    const parsed = descriptor.schema.safeParse(req.params);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join("; ");
      return { status: "error" as const, error: "VALIDATION_ERROR", message };
    }

    const scope = new WorkspaceScope(workspace, defaultFs);
    for (const declaration of descriptor.pathParams) {
      // A declaration names one path, or one per element of an array (`edits[].file`). Every
      // current caller supplies every pathParam it declares, except getTypeErrors's
      // `file`/`tsconfig` — both optional, and mutually exclusive with each other, so either
      // (or neither) can be absent from a given request; a missing value yields no paths.
      for (const value of declaredPathValues(req.params, declaration)) {
        const pathResult = validateFilePath(value);
        if (!pathResult.ok) {
          return {
            status: "error" as const,
            error: "INVALID_PATH",
            message:
              pathResult.reason === "CONTROL_CHARS"
                ? `path contains control characters: ${declaration}`
                : `path contains URI fragment or query character: ${declaration}`,
          };
        }
        if (!scope.contains(value)) {
          return {
            status: "error" as const,
            error: "WORKSPACE_VIOLATION",
            message: `${declaration} is outside the workspace: ${value}`,
          };
        }
      }
    }

    const explicitTsConfig =
      descriptor.tsConfigParam && typeof req.params[descriptor.tsConfigParam] === "string"
        ? (req.params[descriptor.tsConfigParam] as string)
        : undefined;

    if (explicitTsConfig !== undefined) {
      // Engine selection reads this path directly (isVueProject), unlike the discovery
      // routes above it doesn't tolerate a miss — checked here, before that read, so a
      // missing or directory tsconfig comes back as FILE_NOT_FOUND rather than whatever
      // ts-morph/TypeScript does when handed a path that isn't a file.
      if (!defaultFs.exists(explicitTsConfig) || defaultFs.stat(explicitTsConfig).isDirectory()) {
        return {
          status: "error" as const,
          error: "FILE_NOT_FOUND",
          message: `tsconfig not found: ${explicitTsConfig}`,
        };
      }
    }

    // Engine discovery walks up from a real file, so only a top-level row can seed it.
    const engineSeed = descriptor.pathParams
      .filter(isTopLevelPathParam)
      .flatMap((declaration) => declaredPathValues(req.params, declaration))
      .at(0);
    const registry = makeRegistry(engineSeed, workspace, explicitTsConfig);

    const result = (await descriptor.invoke(registry, parsed.data, workspace)) as Record<
      string,
      unknown
    >;

    if (
      parsed.data.checkTypeErrors !== false &&
      Array.isArray(result.filesModified) &&
      (result.filesModified as string[]).length > 0
    ) {
      const engine = await registry.projectEngine();
      const diagnostics = await getTypeErrorsForFiles(
        engine,
        result.filesModified as string[],
        new WorkspaceScope(workspace, defaultFs),
      );
      result.typeErrors = diagnostics.typeErrors;
      result.typeErrorCount = diagnostics.typeErrorCount;
      result.typeErrorsTruncated = diagnostics.typeErrorsTruncated;
    }

    const status =
      typeof result.typeErrorCount === "number" && result.typeErrorCount > 0
        ? ("warn" as const)
        : ("success" as const);
    return { status, ...result };
  } catch (err) {
    return toDispatchError(err, req.method, workspace);
  } finally {
    refreshWrittenFiles();
    onActivity?.();
  }
}

/**
 * Re-read everything this dispatch wrote into whichever engines are loaded, after the
 * operation has returned and holds no nodes into the project. A write made with
 * `checkTypeErrors: false` has no other refresh: the post-write check never runs, and the
 * watcher suppresses the write.
 */
function refreshWrittenFiles(): void {
  for (const filePath of drainPendingMutations()) {
    try {
      refreshWrittenFile(filePath);
    } catch {
      // A refresh prepares later requests, so losing it for one path leaves that path stale.
      // It must not fail the dispatch: the write is already on disk, and the caller still
      // needs its response.
    }
  }
}
