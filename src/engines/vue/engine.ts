import { BaseEngine } from "../engine.js";
import { EngineError } from "../errors.js";
import { VolarProvider } from "../providers/volar.js";
import type { MoveSymbolResult, RefactorEngine } from "../types.js";

export class VueEngine extends BaseEngine implements RefactorEngine {
  private volarProvider: VolarProvider;

  constructor() {
    const p = new VolarProvider();
    super(p);
    this.volarProvider = p;
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
