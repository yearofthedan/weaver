import * as fs from "node:fs";
import * as path from "node:path";
import { EngineError } from "../errors.js";
import { offsetToLineCol } from "../text-utils.js";
import type { FindReferencesResult, LanguageProvider } from "../types.js";

export async function findReferences(
  provider: LanguageProvider,
  filePath: string,
  line: number,
  col: number,
): Promise<FindReferencesResult> {
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
  }

  const offset = provider.resolveOffset(absPath, line, col);
  const refs = await provider.getReferencesAtPosition(absPath, offset);

  if (!refs || refs.length === 0) {
    throw new EngineError(
      `No symbol at line ${line}, col ${col} in ${filePath}`,
      "SYMBOL_NOT_FOUND",
    );
  }

  const firstRef = refs[0];
  const firstContent = provider.readFile(firstRef.fileName);
  const symbolName = firstContent.slice(
    firstRef.textSpan.start,
    firstRef.textSpan.start + firstRef.textSpan.length,
  );

  const references = refs.map((ref) => {
    const content = provider.readFile(ref.fileName);
    const lc = offsetToLineCol(content, ref.textSpan.start);
    return { file: ref.fileName, line: lc.line, col: lc.col, length: ref.textSpan.length };
  });

  return { symbolName, references };
}
