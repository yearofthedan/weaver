import { EngineError } from "../errors.js";
import { VolarProvider } from "../providers/volar.js";
import type { MoveSymbolResult } from "../types.js";

export class VueEngine {
  private volarProvider: VolarProvider;

  constructor(provider?: VolarProvider) {
    this.volarProvider = provider ?? new VolarProvider();
  }

  /**
   * Invalidate the cached Volar service for the project containing `filePath`.
   * Called by the daemon watcher on any file event (change, add, unlink).
   * Volar has no incremental refresh API so full service invalidation is used.
   */
  invalidateFile(filePath: string): void {
    this.volarProvider.invalidateService(filePath);
  }

  async moveSymbol(
    _sourceFile: string,
    symbolName: string,
    _destFile: string,
    _workspace: string,
  ): Promise<MoveSymbolResult> {
    throw new EngineError(
      `moveSymbol is not supported for Vue projects (symbol: '${symbolName}')`,
      "NOT_SUPPORTED",
    );
  }
}
