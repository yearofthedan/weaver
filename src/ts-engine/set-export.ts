import { Node, type SourceFile, type Statement } from "ts-morph";
import { EngineError } from "../domain/errors.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { SetExportResult } from "../operations/types.js";
import type { TsMorphEngine } from "./engine.js";

/** At most this many referencing files are named in a SYMBOL_IN_USE message. */
const MAX_LISTED_FILES = 10;

/**
 * A top-level declaration whose `export` keyword can be toggled.
 *
 * Every declaration form this operation supports carries ts-morph's
 * `ExportableNode` mixin; the intersection names only the part used here.
 */
type ExportableStatement = Statement & {
  isExported(): boolean;
  isDefaultExport(): boolean;
  setIsExported(value: boolean): unknown;
};

/**
 * Add or remove the `export` keyword on a top-level declaration.
 *
 * The remove direction refuses when any other file references the symbol —
 * the dispatcher's post-write type check only covers `filesModified`, so an
 * unguarded un-export would break importers invisibly.
 *
 * Precondition: `file` must exist (validated by the operation layer).
 * TS/TSX only — `.vue` paths are rejected by `VolarEngine` before reaching here.
 *
 * `knownReferences` carries referencing files a caller found outside the
 * ts-morph project graph (Vue SFC scripts), so one message names them all.
 */
export async function tsSetExport(
  engine: TsMorphEngine,
  file: string,
  symbolName: string,
  exported: boolean,
  scope: WorkspaceScope,
  knownReferences: string[] = [],
): Promise<SetExportResult> {
  const project = engine.getProjectForFile(file);
  const sourceFile = project.getSourceFile(file) ?? project.addSourceFileAtPath(file);

  const target = resolveTarget(sourceFile, symbolName, file);

  if (target.isExported() === exported) {
    return { filesModified: [], filesSkipped: [], symbolName };
  }

  if (!exported) {
    const users = [...new Set([...referencingFiles(target, symbolName, file), ...knownReferences])];
    if (users.length > 0) {
      throw new EngineError(inUseMessage(symbolName, file, users.sort()), "SYMBOL_IN_USE");
    }
  }

  target.setIsExported(exported);
  scope.writeFile(file, sourceFile.getFullText());
  engine.invalidateProject(file);

  return { filesModified: scope.modified, filesSkipped: scope.skipped, symbolName };
}

/**
 * Find the single top-level declaration named `symbolName`, or throw explaining
 * why the name cannot be toggled.
 */
function resolveTarget(
  sourceFile: SourceFile,
  symbolName: string,
  file: string,
): ExportableStatement {
  const candidates = topLevelDeclarationsNamed(sourceFile, symbolName);

  if (candidates.length === 0) {
    if (hasReExportOf(sourceFile, symbolName)) {
      throw new EngineError(
        `Symbol '${symbolName}' in ${file} is a re-export via 'export { } from'. Only declarations in this file can have their visibility changed.`,
        "NOT_SUPPORTED",
      );
    }
    throw new EngineError(
      `Symbol '${symbolName}' not found as a top-level declaration in ${file}`,
      "SYMBOL_NOT_FOUND",
    );
  }

  if (candidates.length > 1) {
    throw new EngineError(
      `Symbol '${symbolName}' has ${candidates.length} top-level declarations in ${file}. Overloaded and duplicated names are not supported.`,
      "NOT_SUPPORTED",
    );
  }

  const target = candidates[0];

  if (target.isDefaultExport()) {
    throw new EngineError(
      `Symbol '${symbolName}' in ${file} is a default export. Only named exports are supported.`,
      "NOT_SUPPORTED",
    );
  }

  if (Node.isVariableStatement(target) && target.getDeclarations().length > 1) {
    throw new EngineError(
      `Symbol '${symbolName}' in ${file} is one of several declarators in a single statement. Split the statement first — changing it would carry the siblings along.`,
      "NOT_SUPPORTED",
    );
  }

  if (hasLocalExportSpecifier(sourceFile, symbolName)) {
    throw new EngineError(
      `Symbol '${symbolName}' in ${file} is exported by a separate 'export { }' statement. Only the 'export' keyword on a declaration is supported.`,
      "NOT_SUPPORTED",
    );
  }

  return target;
}

/**
 * Top-level statements declaring `symbolName`. Enums are deliberately absent —
 * they are outside this operation's supported forms, so an enum name reads as
 * not found rather than half-supported.
 */
function topLevelDeclarationsNamed(
  sourceFile: SourceFile,
  symbolName: string,
): ExportableStatement[] {
  const found: ExportableStatement[] = [];
  for (const statement of sourceFile.getStatements()) {
    if (
      Node.isFunctionDeclaration(statement) ||
      Node.isClassDeclaration(statement) ||
      Node.isInterfaceDeclaration(statement) ||
      Node.isTypeAliasDeclaration(statement)
    ) {
      if (statement.getName() === symbolName) found.push(statement);
      continue;
    }
    if (
      Node.isVariableStatement(statement) &&
      statement.getDeclarations().some((declaration) => declaration.getName() === symbolName)
    ) {
      found.push(statement);
    }
  }
  return found;
}

/** `export { foo } from "./other"` — the declaration lives in another module. */
function hasReExportOf(sourceFile: SourceFile, symbolName: string): boolean {
  return sourceFile
    .getExportDeclarations()
    .some(
      (declaration) =>
        declaration.getModuleSpecifierValue() !== undefined && namesExport(declaration, symbolName),
    );
}

/** `export { foo };` — visibility comes from a statement, not the declaration. */
function hasLocalExportSpecifier(sourceFile: SourceFile, symbolName: string): boolean {
  return sourceFile
    .getExportDeclarations()
    .some(
      (declaration) =>
        declaration.getModuleSpecifierValue() === undefined && namesExport(declaration, symbolName),
    );
}

function namesExport(
  declaration: ReturnType<SourceFile["getExportDeclarations"]>[number],
  symbolName: string,
): boolean {
  return declaration
    .getNamedExports()
    .some(
      (specifier) => (specifier.getAliasNode()?.getText() ?? specifier.getName()) === symbolName,
    );
}

/** Files other than the declaring one that reference the symbol, via the project graph. */
function referencingFiles(target: ExportableStatement, symbolName: string, file: string): string[] {
  const files = new Set<string>();
  for (const node of nameNodeOf(target, symbolName).findReferencesAsNodes()) {
    const referencingFile = node.getSourceFile().getFilePath() as string;
    if (referencingFile !== file) files.add(referencingFile);
  }
  return [...files];
}

function nameNodeOf(
  target: ExportableStatement,
  symbolName: string,
): Node & {
  findReferencesAsNodes(): Node[];
} {
  if (Node.isVariableStatement(target)) {
    const declaration = target
      .getDeclarations()
      .find((candidate) => candidate.getName() === symbolName);
    // resolveTarget only returns a variable statement that declares this name.
    if (declaration === undefined) {
      throw new EngineError(
        `Declarator '${symbolName}' vanished from its own statement — this is a bug`,
        "INTERNAL_ERROR",
      );
    }
    return declaration.getNameNode() as Node & { findReferencesAsNodes(): Node[] };
  }
  return (target as unknown as { getNameNode(): Node }).getNameNode() as Node & {
    findReferencesAsNodes(): Node[];
  };
}

function inUseMessage(symbolName: string, file: string, users: string[]): string {
  const listed = users.slice(0, MAX_LISTED_FILES).join(", ");
  const overflow = users.length > MAX_LISTED_FILES ? ", ..." : "";
  return `Symbol '${symbolName}' in ${file} is used by ${users.length} other file(s); un-exporting it would break them: ${listed}${overflow}`;
}
