import type { LanguagePlugin, LanguageProvider } from "../../types.js";
import { isVueProject } from "../../utils/ts-project.js";

export function createVueLanguagePlugin(): LanguagePlugin {
  let cachedProvider: import("./compiler.js").VolarProvider | undefined;
  return {
    id: "vue-volar",
    supportsProject(tsconfigPath: string): boolean {
      return isVueProject(tsconfigPath);
    },
    async createProvider(): Promise<LanguageProvider> {
      if (!cachedProvider) {
        const { VolarProvider } = await import("./compiler.js");
        cachedProvider = new VolarProvider();
      }
      return cachedProvider;
    },
    invalidateFile(filePath: string): void {
      cachedProvider?.invalidateService(filePath);
    },
    invalidateAll(): void {
      cachedProvider = undefined;
    },
  };
}
