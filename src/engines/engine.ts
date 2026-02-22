import * as fs from "node:fs";
import * as path from "node:path";
import { isWithinWorkspace } from "../workspace.js";
import { EngineError } from "./errors.js";
import { applyTextEdits, offsetToLineCol } from "./text-utils.js";
import type {
  FindReferencesResult,
  GetDefinitionResult,
  LanguageProvider,
  MoveResult,
  RenameResult,
} from "./types.js";

/**
 * Shared engine implementation for rename, findReferences, getDefinition, and
 * moveFile. Parameterised by a LanguageProvider so compiler-specific logic
 * stays in TsProvider / VolarProvider while file I/O, workspace filtering, and
 * result shaping live here exactly once.
 *
 * TsEngine and VueEngine extend this class and add their own moveSymbol.
 */
export class BaseEngine {
  constructor(protected readonly provider: LanguageProvider) {}

  async rename(
    filePath: string,
    line: number,
    col: number,
    newName: string,
    workspace: string,
  ): Promise<RenameResult> {
    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
      throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
    }

    const offset = this.provider.resolveOffset(absPath, line, col);
    // getRenameLocations throws RENAME_NOT_ALLOWED when appropriate.
    const locs = await this.provider.getRenameLocations(absPath, offset);

    if (!locs || locs.length === 0) {
      throw new EngineError(
        `No renameable symbol at line ${line}, col ${col} in ${filePath}`,
        "SYMBOL_NOT_FOUND",
      );
    }

    // Determine the original symbol name from the first translated location.
    const firstLoc = locs[0];
    const firstContent = this.provider.readFile(firstLoc.fileName);
    const oldName = firstContent.slice(
      firstLoc.textSpan.start,
      firstLoc.textSpan.start + firstLoc.textSpan.length,
    );

    // Group edits by file.
    const editsByFile = new Map<
      string,
      { span: { start: number; length: number }; newText: string }[]
    >();
    for (const loc of locs) {
      if (!editsByFile.has(loc.fileName)) editsByFile.set(loc.fileName, []);
      editsByFile.get(loc.fileName)?.push({ span: loc.textSpan, newText: newName });
    }

    const filesModified: string[] = [];
    const filesSkipped: string[] = [];

    for (const [fileName, edits] of editsByFile) {
      if (!isWithinWorkspace(fileName, workspace)) {
        filesSkipped.push(fileName);
        continue;
      }
      const original = this.provider.readFile(fileName);
      const updated = applyTextEdits(original, edits);
      fs.writeFileSync(fileName, updated, "utf8");
      this.provider.notifyFileWritten(fileName, updated);
      filesModified.push(fileName);
    }

    return {
      filesModified,
      filesSkipped,
      symbolName: oldName,
      newName,
      locationCount: locs.length,
    };
  }

  async findReferences(filePath: string, line: number, col: number): Promise<FindReferencesResult> {
    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
      throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
    }

    const offset = this.provider.resolveOffset(absPath, line, col);
    const refs = await this.provider.getReferencesAtPosition(absPath, offset);

    if (!refs || refs.length === 0) {
      throw new EngineError(
        `No symbol at line ${line}, col ${col} in ${filePath}`,
        "SYMBOL_NOT_FOUND",
      );
    }

    const firstRef = refs[0];
    const firstContent = this.provider.readFile(firstRef.fileName);
    const symbolName = firstContent.slice(
      firstRef.textSpan.start,
      firstRef.textSpan.start + firstRef.textSpan.length,
    );

    const references = refs.map((ref) => {
      const content = this.provider.readFile(ref.fileName);
      const lc = offsetToLineCol(content, ref.textSpan.start);
      return { file: ref.fileName, line: lc.line, col: lc.col, length: ref.textSpan.length };
    });

    return { symbolName, references };
  }

  async getDefinition(filePath: string, line: number, col: number): Promise<GetDefinitionResult> {
    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
      throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
    }

    const offset = this.provider.resolveOffset(absPath, line, col);
    const defs = await this.provider.getDefinitionAtPosition(absPath, offset);

    if (!defs || defs.length === 0) {
      throw new EngineError(
        `No symbol at line ${line}, col ${col} in ${filePath}`,
        "SYMBOL_NOT_FOUND",
      );
    }

    const symbolName = defs[0].name;

    const definitions = defs.map((def) => {
      const content = this.provider.readFile(def.fileName);
      const lc = offsetToLineCol(content, def.textSpan.start);
      return { file: def.fileName, line: lc.line, col: lc.col, length: def.textSpan.length };
    });

    return { symbolName, definitions };
  }

  async moveFile(oldPath: string, newPath: string, workspace: string): Promise<MoveResult> {
    const absOld = path.resolve(oldPath);
    const absNew = path.resolve(newPath);

    if (!fs.existsSync(absOld)) {
      throw new EngineError(`File not found: ${oldPath}`, "FILE_NOT_FOUND");
    }

    const edits = await this.provider.getEditsForFileRename(absOld, absNew);

    const filesModified: string[] = [];
    const filesSkipped: string[] = [];

    for (const edit of edits) {
      if (!isWithinWorkspace(edit.fileName, workspace)) {
        if (!filesSkipped.includes(edit.fileName)) filesSkipped.push(edit.fileName);
        continue;
      }
      const original = this.provider.readFile(edit.fileName);
      const updated = applyTextEdits(original, edit.textChanges);
      fs.writeFileSync(edit.fileName, updated, "utf8");
      this.provider.notifyFileWritten(edit.fileName, updated);
      if (!filesModified.includes(edit.fileName)) filesModified.push(edit.fileName);
    }

    // Physical move.
    const destDir = path.dirname(absNew);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.renameSync(absOld, absNew);

    // Provider cleanup (cache invalidation, post-move scans, etc.).
    const { modified: extraModified, skipped: extraSkipped } = await this.provider.afterFileRename(
      absOld,
      absNew,
      workspace,
    );

    for (const f of extraModified) {
      if (!filesModified.includes(f)) filesModified.push(f);
    }
    for (const f of extraSkipped) {
      if (!filesSkipped.includes(f)) filesSkipped.push(f);
    }

    if (!filesModified.includes(absNew)) filesModified.push(absNew);

    return { filesModified, filesSkipped, oldPath: absOld, newPath: absNew };
  }
}
