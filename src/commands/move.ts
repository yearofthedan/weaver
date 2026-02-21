import * as path from "node:path";
import { outputError, outputSuccess } from "../output.js";
import { getEngine } from "../daemon/router.js";
import { MoveArgsSchema } from "../schema.js";

export async function runMove(rawArgs: { oldPath: string; newPath: string }): Promise<void> {
  const parsed = MoveArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const messages = parsed.error.errors.map((e) => e.message).join("; ");
    outputError("VALIDATION_ERROR", messages);
  }

  const { oldPath, newPath } = parsed.data;
  const absOld = path.resolve(oldPath);
  const absNew = path.resolve(newPath);

  try {
    const engine = await getEngine(absOld);
    const result = await engine.moveFile(absOld, absNew);

    const fileCount = result.filesModified.length;
    const fileWord = fileCount === 1 ? "file" : "files";

    outputSuccess(
      result.filesModified,
      `Moved '${oldPath}' to '${newPath}', updated imports in ${fileCount} ${fileWord}`,
    );
  } catch (err: unknown) {
    if (err instanceof Error) {
      const code = (err as { code?: string }).code;
      if (code === "FILE_NOT_FOUND" || code === "TSCONFIG_NOT_FOUND") {
        outputError(code as Parameters<typeof outputError>[0], err.message);
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    outputError("ENGINE_ERROR", message);
  }
}
