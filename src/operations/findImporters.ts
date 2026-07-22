import * as path from "node:path";
import type { FileSystem } from "../ports/filesystem.js";
import type { Engine } from "../ts-engine/types.js";
import { assertFileExists } from "../utils/assert-file.js";
import { offsetToLineCol } from "../utils/text-utils.js";
import type { FindImportersResult } from "./types.js";

export async function findImporters(
  compiler: Engine,
  filePath: string,
  fs: FileSystem,
): Promise<FindImportersResult> {
  const absPath = assertFileExists(filePath, fs);

  const refs = await compiler.getFileReferences(absPath);
  const fileName = path.basename(absPath);

  if (!refs || refs.length === 0) {
    return { fileName, references: [] };
  }

  const references = refs.map((ref) => {
    const content = compiler.readFile(ref.fileName);
    const lc = offsetToLineCol(content, ref.textSpan.start);
    return { file: ref.fileName, line: lc.line, col: lc.col, length: ref.textSpan.length };
  });

  return { fileName, references };
}
