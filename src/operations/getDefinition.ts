import { EngineError } from "../domain/errors.js";
import type { FileSystem } from "../ports/filesystem.js";
import type { Engine } from "../ts-engine/types.js";
import { assertFileExists } from "../utils/assert-file.js";
import { offsetToLineCol } from "../utils/text-utils.js";
import type { GetDefinitionResult } from "./types.js";

export async function getDefinition(
  compiler: Engine,
  filePath: string,
  line: number,
  col: number,
  fs: FileSystem,
): Promise<GetDefinitionResult> {
  const absPath = assertFileExists(filePath, fs);

  const offset = compiler.resolveOffset(absPath, line, col);
  const defs = await compiler.getDefinitionAtPosition(absPath, offset);

  if (!defs || defs.length === 0) {
    throw new EngineError(
      `No symbol at line ${line}, col ${col} in ${filePath}`,
      "SYMBOL_NOT_FOUND",
    );
  }

  const symbolName = defs[0].name;

  const definitions = defs.map((def) => {
    const content = compiler.readFile(def.fileName);
    const lc = offsetToLineCol(content, def.textSpan.start);
    return { file: def.fileName, line: lc.line, col: lc.col, length: def.textSpan.length };
  });

  return { symbolName, definitions };
}
