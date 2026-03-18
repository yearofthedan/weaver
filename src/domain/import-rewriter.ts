import * as path from "node:path";
import { createThrowawaySourceFile } from "../compilers/throwaway-project.js";
import { JS_TS_PAIRS } from "../utils/extensions.js";
import { computeRelativeImportPath, toRelBase } from "../utils/relative-path.js";
import type { WorkspaceScope } from "./workspace-scope.js";

/**
 * Rewrites named imports and re-exports of a moved symbol across a set of files.
 *
 * Operates on script content only — callers are responsible for extracting
 * script blocks from SFCs before calling and splicing them back after.
 * Uses throwaway in-memory ts-morph projects to parse and mutate import/export
 * declarations — no regex for import syntax.
 */
export class ImportRewriter {
  /**
   * Rewrite named imports and re-exports of `symbolName` from `oldSource`
   * to `newSource` across a set of files.
   *
   * Each file is read via `scope.fs.readFile()` and written via
   * `scope.writeFile()`. Files outside the workspace are recorded as skipped.
   */
  rewrite(
    files: Iterable<string>,
    symbolName: string,
    oldSource: string,
    newSource: string,
    scope: WorkspaceScope,
  ): void {
    for (const filePath of files) {
      if (!scope.contains(filePath)) {
        scope.recordSkipped(filePath);
        continue;
      }
      const raw = scope.fs.readFile(filePath);
      const result = this.rewriteScript(filePath, raw, symbolName, oldSource, newSource, scope);
      if (result !== null) {
        scope.writeFile(filePath, result);
      }
    }
  }

  /**
   * Rewrite import/export declarations in a single script string.
   *
   * `filePath` is used only for computing relative specifiers — the content
   * does not need to exist on disk. Returns the rewritten text, or `null`
   * if no matching declarations were found.
   *
   * This is the public entry point for callers that handle SFC extraction
   * themselves (e.g. Vue/Svelte plugins).
   */
  rewriteScript(
    filePath: string,
    content: string,
    symbolName: string,
    oldSource: string,
    newSource: string,
    scope: WorkspaceScope,
  ): string | null {
    const fromDir = path.dirname(filePath);
    const relOldBase = toRelBase(fromDir, oldSource);
    const sf = createThrowawaySourceFile("__rewrite__.ts", content);
    let hasChanges = false;

    for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
      const specifier = decl.getModuleSpecifierValue();
      if (specifier === undefined) continue;
      if (!this.matchesSourceFile(specifier, relOldBase, fromDir, scope)) continue;

      if ("getNamedImports" in decl) {
        hasChanges = this.rewriteImport(decl, sf, symbolName, filePath, newSource) || hasChanges;
      } else {
        hasChanges = this.rewriteExport(decl, sf, symbolName, filePath, newSource) || hasChanges;
      }
    }

    if (!hasChanges) return null;
    return sf.getFullText();
  }

  private rewriteImport(
    decl: ReturnType<import("ts-morph").SourceFile["getImportDeclarations"]>[number],
    sf: import("ts-morph").SourceFile,
    symbolName: string,
    filePath: string,
    newSource: string,
  ): boolean {
    const named = decl.getNamedImports();
    const matching = named.filter((s) => s.getName() === symbolName);
    if (matching.length === 0) return false;

    const destSpecifier = computeRelativeImportPath(filePath, newSource);

    if (named.length === matching.length) {
      const existingDest = sf
        .getImportDeclarations()
        .find(
          (id) =>
            id !== decl &&
            this.matchesDestSpecifier(id.getModuleSpecifierValue(), filePath, newSource),
        );
      if (existingDest) {
        existingDest.addNamedImport(symbolName);
        decl.remove();
      } else {
        decl.setModuleSpecifier(destSpecifier);
      }
    } else {
      for (const spec of matching) {
        spec.remove();
      }
      const existingDest = sf
        .getImportDeclarations()
        .find((id) => this.matchesDestSpecifier(id.getModuleSpecifierValue(), filePath, newSource));
      if (existingDest) {
        existingDest.addNamedImport(symbolName);
      } else {
        sf.addImportDeclaration({
          namedImports: [symbolName],
          moduleSpecifier: destSpecifier,
        });
      }
    }
    return true;
  }

  private rewriteExport(
    decl: ReturnType<import("ts-morph").SourceFile["getExportDeclarations"]>[number],
    sf: import("ts-morph").SourceFile,
    symbolName: string,
    filePath: string,
    newSource: string,
  ): boolean {
    const named = decl.getNamedExports();
    const matching = named.filter((s) => s.getName() === symbolName);
    if (matching.length === 0) return false;

    const destSpecifier = computeRelativeImportPath(filePath, newSource);

    if (named.length === matching.length) {
      decl.setModuleSpecifier(destSpecifier);
    } else {
      for (const spec of matching) {
        spec.remove();
      }
      sf.addExportDeclaration({
        namedExports: [symbolName],
        moduleSpecifier: destSpecifier,
      });
    }
    return true;
  }

  private matchesSourceFile(
    specifier: string,
    relOldBase: string,
    fromDir: string,
    scope: WorkspaceScope,
  ): boolean {
    if (specifier === relOldBase) return true;

    for (const [jsExt, tsExt] of JS_TS_PAIRS) {
      if (specifier === relOldBase + jsExt) {
        const resolvedJsPath = path.resolve(fromDir, specifier);
        if (scope.fs.exists(resolvedJsPath)) return false;
        return true;
      }
      if (specifier === relOldBase + tsExt) return true;
    }

    return false;
  }

  private matchesDestSpecifier(
    specifier: string | undefined,
    filePath: string,
    newSource: string,
  ): boolean {
    if (!specifier) return false;
    const fromDir = path.dirname(filePath);
    const relBase = toRelBase(fromDir, newSource);
    // Bare specifier (no extension).
    if (specifier === relBase) return true;
    // JS-family and TS-family extensions.
    for (const [jsExt, tsExt] of JS_TS_PAIRS) {
      if (specifier === relBase + jsExt) return true;
      if (specifier === relBase + tsExt) return true;
    }
    return false;
  }
}
