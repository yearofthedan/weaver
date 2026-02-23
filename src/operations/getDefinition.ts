import * as fs from "node:fs";
import * as path from "node:path";
import type { GetDefinitionResult, LanguageProvider } from "../types.js";
import { EngineError } from "../utils/errors.js";
import { offsetToLineCol } from "../utils/text-utils.js";

export async function getDefinition(
  provider: LanguageProvider,
  filePath: string,
  line: number,
  col: number,
): Promise<GetDefinitionResult> {
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
  }

  const offset = provider.resolveOffset(absPath, line, col);
  const defs = await provider.getDefinitionAtPosition(absPath, offset);

  if (!defs || defs.length === 0) {
    throw new EngineError(
      `No symbol at line ${line}, col ${col} in ${filePath}`,
      "SYMBOL_NOT_FOUND",
    );
  }

  const symbolName = defs[0].name;

  const definitions = defs.map((def) => {
    const content = provider.readFile(def.fileName);
    const lc = offsetToLineCol(content, def.textSpan.start);
    return { file: def.fileName, line: lc.line, col: lc.col, length: def.textSpan.length };
  });

  return { symbolName, definitions };
}
