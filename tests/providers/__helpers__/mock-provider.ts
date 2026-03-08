import { vi } from "vitest";
import type { LanguageProvider } from "../../../src/types.js";

// TODO: replace with a shared TestProvider class once one exists — a class
// with injectable stubs would be cleaner than vi.fn() mocks here.
export function makeMockProvider(overrides: Partial<LanguageProvider> = {}): LanguageProvider {
  return {
    resolveOffset: vi.fn().mockReturnValue(0),
    getRenameLocations: vi.fn().mockResolvedValue(null),
    getReferencesAtPosition: vi.fn().mockResolvedValue(null),
    getDefinitionAtPosition: vi.fn().mockResolvedValue(null),
    getEditsForFileRename: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockReturnValue(""),
    notifyFileWritten: vi.fn(),
    afterFileRename: vi.fn().mockResolvedValue({ modified: [], skipped: [] }),
    afterSymbolMove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
