import { EngineError } from "../domain/errors.js";
import type { FileSystem } from "../ports/filesystem.js";
import type { Engine } from "../ts-engine/types.js";
import { assertFileExists } from "../utils/assert-file.js";
import { offsetToLineCol } from "../utils/text-utils.js";
import type { FindReferencesResult } from "./types.js";

export async function findReferences(
  compiler: Engine,
  filePath: string,
  line: number,
  col: number,
  fs: FileSystem,
): Promise<FindReferencesResult> {
  const absPath = assertFileExists(filePath, fs);

  const offset = compiler.resolveOffset(absPath, line, col);
  const refs = await compiler.getReferencesAtPosition(absPath, offset);

  if (!refs || refs.length === 0) {
    throw new EngineError(
      `No symbol at line ${line}, col ${col} in ${filePath}`,
      "SYMBOL_NOT_FOUND",
    );
  }

  const firstRef = refs[0];
  const firstContent = compiler.readFile(firstRef.fileName);
  const symbolName = firstContent.slice(
    firstRef.textSpan.start,
    firstRef.textSpan.start + firstRef.textSpan.length,
  );

  const references = refs.map((ref) => {
    const content = compiler.readFile(ref.fileName);
    const lc = offsetToLineCol(content, ref.textSpan.start);
    return { file: ref.fileName, line: lc.line, col: lc.col, length: ref.textSpan.length };
  });

  return { symbolName, references };
}
