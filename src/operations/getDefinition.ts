import * as fs from "node:fs";
import * as path from "node:path";
import type { Compiler } from "../compilers/types.js";
import { EngineError } from "../utils/errors.js";
import { offsetToLineCol } from "../utils/text-utils.js";
import type { GetDefinitionResult } from "./types.js";

export async function getDefinition(
  compiler: Compiler,
  filePath: string,
  line: number,
  col: number,
): Promise<GetDefinitionResult> {
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
  }

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
