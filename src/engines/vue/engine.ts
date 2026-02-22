import { BaseEngine } from "../engine.js";
import { EngineError } from "../errors.js";
import { VolarProvider } from "../providers/volar.js";
import type { MoveSymbolResult, RefactorEngine } from "../types.js";

export class VueEngine extends BaseEngine implements RefactorEngine {
  constructor() {
    super(new VolarProvider());
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
