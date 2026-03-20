import type { Engine, LanguagePlugin } from "../../ts-engine/types.js";
import { isVueProject } from "../../utils/ts-project.js";

export function createVueLanguagePlugin(): LanguagePlugin {
  let cachedCompiler: import("./compiler.js").VolarCompiler | undefined;
  return {
    id: "vue-volar",
    supportsProject(tsconfigPath: string): boolean {
      return isVueProject(tsconfigPath);
    },
    async createCompiler(): Promise<Engine> {
      if (!cachedCompiler) {
        const { VolarCompiler } = await import("./compiler.js");
        cachedCompiler = new VolarCompiler();
      }
      return cachedCompiler;
    },
    invalidateFile(filePath: string): void {
      cachedCompiler?.invalidateService(filePath);
    },
    invalidateAll(): void {
      cachedCompiler = undefined;
    },
  };
}
