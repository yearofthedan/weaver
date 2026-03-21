import { vi } from "vitest";
import type { Engine } from "../../ts-engine/types.js";
// TODO: replace with a shared TestCompiler class once one exists — a class
// with injectable stubs would be cleaner than vi.fn() mocks here.
export function makeMockCompiler(overrides: Partial<Engine> = {}): Engine {
  return {
    resolveOffset: vi.fn().mockReturnValue(0),
    getRenameLocations: vi.fn().mockResolvedValue(null),
    getReferencesAtPosition: vi.fn().mockResolvedValue(null),
    getDefinitionAtPosition: vi.fn().mockResolvedValue(null),
    readFile: vi.fn().mockReturnValue(""),
    notifyFileWritten: vi.fn(),
    moveFile: vi.fn().mockResolvedValue({ oldPath: "", newPath: "" }),
    moveSymbol: vi.fn().mockResolvedValue(undefined),
    moveDirectory: vi.fn().mockResolvedValue({ filesMoved: [] }),
    deleteFile: vi.fn().mockResolvedValue({ importRefsRemoved: 0 }),
    ...overrides,
  };
}
