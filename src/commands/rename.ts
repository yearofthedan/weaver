import * as path from "node:path";
import { outputError, outputSuccess } from "../output.js";
import { getEngine } from "../daemon/router.js";
import { RenameArgsSchema } from "../schema.js";

export async function runRename(rawArgs: {
  file: string;
  line: string | number;
  col: string | number;
  newName: string;
}): Promise<void> {
  const parsed = RenameArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const messages = parsed.error.errors.map((e) => e.message).join("; ");
    outputError("VALIDATION_ERROR", messages);
  }

  const { file, line, col, newName } = parsed.data;
  const absFile = path.resolve(file);

  try {
    const engine = await getEngine(absFile);
    const result = await engine.rename(absFile, line, col, newName);

    const plural = result.locationCount === 1 ? "location" : "locations";
    const fileCount = result.filesModified.length;
    const fileWord = fileCount === 1 ? "file" : "files";

    outputSuccess(
      result.filesModified,
      `Renamed '${result.symbolName}' to '${result.newName}' in ${result.locationCount} ${plural} across ${fileCount} ${fileWord}`,
    );
  } catch (err: unknown) {
    if (err instanceof Error) {
      const code = (err as { code?: string }).code;
      if (
        code === "FILE_NOT_FOUND" ||
        code === "SYMBOL_NOT_FOUND" ||
        code === "RENAME_NOT_ALLOWED" ||
        code === "TSCONFIG_NOT_FOUND"
      ) {
        outputError(code as Parameters<typeof outputError>[0], err.message);
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    outputError("ENGINE_ERROR", message);
  }
}
