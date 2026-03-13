# Rename `providers/` to `compilers/`

**type:** change
**date:** 2026-03-12
**tracks:** handoff.md # compiler adapter restructure step 5 → docs/target-architecture.md

---

## Context

Step 5 of the seven-step strangler migration described in `docs/target-architecture.md`. Steps 1-4 (FileSystem port, WorkspaceScope, moveSymbol compiler extraction, ImportRewriter extraction) are complete and archived. This step is a pure mechanical rename — no logic changes.

The current names (`providers/`, `LanguageProvider`, `TsProvider`, `VolarProvider`) date from the original architecture where providers were the only abstraction. Now that domain services (`ImportRewriter`, `WorkspaceScope`) and ports (`FileSystem`) exist as separate layers, the remaining provider files are compiler adapters. The name should reflect what they are.

## User intent

*As a contributor to light-bridge, I want all "provider" terminology renamed to "compiler" terminology across the codebase, so that the vocabulary matches the target architecture and new contributors understand the layer's role without reading historical context.*

## Relevant files

**Source files being moved:**
- `src/providers/ts.ts` — `TsProvider` class; becomes `src/compilers/ts.ts` / `TsMorphCompiler`
- `src/providers/ts-move-symbol.ts` — `tsMoveSymbol()` function; becomes `src/compilers/ts-move-symbol.ts`
- `src/plugins/vue/provider.ts` — `VolarProvider` class; becomes `src/plugins/vue/compiler.ts` / `VolarCompiler`

**Test files being moved:**
- `tests/providers/ts.test.ts` — becomes `tests/compilers/ts.test.ts`
- `tests/providers/ts-move-symbol.test.ts`
- `tests/providers/ts-move-symbol-imports.test.ts`
- `tests/providers/ts-move-symbol-errors.test.ts`
- `tests/providers/ts-after-symbol-move.test.ts`
- `tests/providers/__helpers__/mock-provider.ts` — becomes `tests/compilers/__helpers__/mock-compiler.ts`

**Type definitions:**
- `src/types.ts` — `LanguageProvider` interface, `ProviderRegistry` interface, `LanguagePlugin.createProvider()` return type

**Docs to update:**
- `docs/architecture.md`, `docs/handoff.md`, `docs/features/README.md`, `docs/features/moveFile.md`, `docs/features/rename.md`, `docs/features/getDefinition.md`, `docs/features/getTypeErrors.md`, `docs/features/mcp-transport.md`, `docs/tech/volar-v3.md`

### Red flags

- **Stale handoff.md directory listing:** lists `ts-move-file.ts` under `src/providers/` but this file does not exist. Clean up during the rename.
- **Archived specs reference old names.** `docs/specs/archive/` files are historical records — must NOT be updated.

## Value / Effort

- **Value:** Vocabulary alignment with target architecture. Every new contributor or agent currently sees `providers/` and must mentally translate. Completes the public identity change before steps 6-8 cement the new names further.
- **Effort:** Low. Pure mechanical rename — no logic changes, no new abstractions, no test behaviour changes. Wide blast radius (30+ files) but each change is a find-and-replace. Light-bridge `moveFile` handles directory/file renames + import path updates atomically; `rename` handles identifier renames across the project.

## Behaviour

- [x] **AC1: File moves and import path updates.** Use `mcp__light-bridge__moveFile` for each move. This atomically renames the file AND rewrites all import paths pointing to it:
  - `src/providers/ts.ts` → `src/compilers/ts.ts`
  - `src/providers/ts-move-symbol.ts` → `src/compilers/ts-move-symbol.ts`
  - `src/plugins/vue/provider.ts` → `src/plugins/vue/compiler.ts`
  - `tests/providers/ts.test.ts` → `tests/compilers/ts.test.ts`
  - `tests/providers/ts-move-symbol.test.ts` → `tests/compilers/ts-move-symbol.test.ts`
  - `tests/providers/ts-move-symbol-imports.test.ts` → `tests/compilers/ts-move-symbol-imports.test.ts`
  - `tests/providers/ts-move-symbol-errors.test.ts` → `tests/compilers/ts-move-symbol-errors.test.ts`
  - `tests/providers/ts-after-symbol-move.test.ts` → `tests/compilers/ts-after-symbol-move.test.ts`
  - `tests/providers/__helpers__/mock-provider.ts` → `tests/compilers/__helpers__/mock-compiler.ts`
  - Old directories and files no longer exist. No import resolves to a non-existent path.
  - Note: `moveFile` only rewrites imports in files within `tsconfig.include`. Test file imports may need manual fixup — check after moves and use `replaceText` if needed.
  - `src/daemon/language-plugin-registry.ts` stays as-is (it manages plugins, not compilers).

- [x] **AC2: Type, class, and method renames.** Use `mcp__light-bridge__rename` for each identifier rename. The following renames are applied across all source and test files:
  - `LanguageProvider` (interface) → `Compiler`
  - `TsProvider` (class) → `TsMorphCompiler`
  - `VolarProvider` (class) → `VolarCompiler`
  - `ProviderRegistry` (interface) → `CompilerRegistry`
  - `projectProvider()` (method on registry) → `projectCompiler()`
  - `tsProvider()` (method on registry) → `tsCompiler()`
  - `createProvider()` (method on `LanguagePlugin`) → `createCompiler()`
  - `makeMockProvider` (test helper function) → `makeMockCompiler`
  - All derived variable names (e.g. `tsProviderSingleton` → `tsMorphCompilerSingleton`, `pluginProviders` → `pluginCompilers`, `stubProvider` → `stubCompiler`) are updated to match.
  - `LanguagePlugin` is NOT renamed.

- [x] **AC3: Documentation updated.** `docs/architecture.md`, `docs/handoff.md` (including directory listing), all feature docs under `docs/features/`, and `docs/tech/volar-v3.md` are updated to use the new names. Stale `ts-move-file.ts` entry removed from handoff.md. Archived specs in `docs/specs/archive/` are NOT modified. `docs/target-architecture.md` already uses target names (verify, do not assume).

## Interface

No public tool interface changes. MCP tool names, CLI commands, and response shapes are unchanged. All renames are internal: type interfaces, class names, method names, file paths, and documentation.

## Resolved decisions

1. **`language-plugin-registry.ts` filename:** Keep as-is. It manages plugins, not compilers.
2. **`mock-provider.ts`:** Rename to `mock-compiler.ts`, `makeMockProvider` → `makeMockCompiler`.
3. **`plugins/vue/provider.ts`:** Rename to `compiler.ts`. Matches target architecture diagram.
4. **`ProviderRegistry` and methods:** Rename to `CompilerRegistry`, `projectCompiler()`, `tsCompiler()`.
5. **`LanguagePlugin.createProvider()`:** Rename to `createCompiler()`.

## Security

- **Workspace boundary:** N/A — no file reads/writes at runtime. Development-time refactoring only.
- **Sensitive file exposure:** N/A — no new file reading paths.
- **Input injection:** N/A — no new parameters.
- **Response leakage:** N/A — no response changes.

## Edges

- **Archived specs are not modified.** They are historical records. Old names in `docs/specs/archive/` are expected.
- **No runtime behaviour change.** Every test must pass with identical assertions (modulo import paths and type names). If any test needs a logic change, the scope has been exceeded.
- **`LanguagePlugin` interface is unchanged** except `createProvider()` → `createCompiler()`.

## Done-when

- [x] All ACs verified (all existing tests pass with updated imports/names)
- [x] `pnpm check` passes (lint + build + test)
- [x] No source or test file imports a path containing `providers/`
- [x] No source or test file (excluding `docs/specs/archive/`) contains old identifier names
- [x] `docs/architecture.md` and `docs/handoff.md` use the new vocabulary throughout
- [x] Feature docs updated
- [x] Stale `ts-move-file.ts` entry removed from handoff.md directory listing
- [x] Non-obvious gotchas captured in docs/agent-memory.md
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Reflection

**Went well:** AC1 used `moveFile` for all 9 file moves — atomic move + import rewrite, exactly as intended. AC2 used `rename` for 8 identifier definitions and it correctly propagated across all references. All 570 tests pass, zero logic changes.

**Didn't go well:** The first spec version split "move files" and "fix imports" into separate ACs, which made `git mv` look like the right tool and `moveFile` look wrong. The execution agent wrote a detailed handoff reflection justifying `git mv` — articulate but incorrect. Had to rewrite the spec and reset. AC2 took 126 tool calls because derived variable names (`tsProviderSingleton`, `pluginProviders`) were fixed one by one instead of in a single `replaceText` pass.

**Lesson:** ACs must each leave the codebase working. Don't split an atomic tool operation across ACs — it makes the wrong tool look correct.

## Outcome

- **Tests:** 0 new tests added. All 570 existing tests pass unchanged (modulo import paths and type names).
- **Mutation score:** N/A — no logic changes, all mutations would be in string literals.
- **Files touched:** ~60 files across source, tests, and docs.
- **Tools used:** `moveFile` (13 calls — 9 source/test + 4 test filename renames), `rename` (8 calls for identifier definitions), `replaceText` (derived variable names + doc updates).
- **Key decision:** Kept `Compiler` over `CompilerAdapter` — TypeScript is a compiler; these classes wrap the compiler's language service. Brevity wins at scale across dozens of files.
