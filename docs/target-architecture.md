# Target Architecture

**Purpose:** Where the codebase should go. The "why" (see `why.md`) doesn't change — compiler-driven refactoring as agent infrastructure. This doc describes the structural changes needed to get there cleanly.
**Status:** Draft — not yet implemented. The current architecture is in `architecture.md`.
**Related docs:** [Why](why.md) (invariant), [Architecture](architecture.md) (current state), [Handoff](handoff.md) (task queue)

---

## What's wrong today

The current codebase has no domain model. Operations are procedural scripts that reach directly into compiler APIs, scatter `fs` calls throughout, and reimplement the same patterns (workspace filtering, import rewriting, file persistence) independently.

**Concrete symptoms:**

1. **`moveSymbol` is 220 lines** doing six unrelated jobs: symbol lookup, destination prep, importer snapshot, AST surgery, import rewriting, file persistence. The test file needs 786 lines and helper extraction just to cover it.

2. **Import rewriting is implemented three times:** once in `moveSymbol` (lines 146-182), once in `TsProvider.afterSymbolMove` (the out-of-project fallback), and once in `plugins/vue/scan.ts` (regex-based for Vue SFCs). The first two are structurally identical.

3. **Every operation reimplements workspace boundary tracking.** Each one creates `Set<string>` for modified/skipped, checks `isWithinWorkspace` in a loop, and assembles the result. This is the same ~15 lines copy-pasted across `rename`, `moveFile`, `moveSymbol`, `deleteFile`.

4. **`fs` calls are scattered everywhere.** Operations call `fs.readFileSync`, `fs.writeFileSync`, `fs.existsSync`, `fs.mkdirSync` directly. This makes unit testing impossible without real temp directories. Every test pays the cost of fixture copying, directory creation, and cleanup.

5. **`LanguageProvider` conflates two roles.** It serves as both a compiler query interface (getRenameLocations, getReferencesAtPosition) and a post-step hook container (afterFileRename, afterSymbolMove). The interface is growing because operations keep needing "one more hook."

6. **Operations reach past the provider abstraction.** `moveSymbol`, `deleteFile`, and `extractFunction` take `TsProvider` directly and call `getProjectForFile()` to access ts-morph internals. The provider boundary doesn't actually abstract anything for these operations.

---

## Design principles

These follow from the "why" and from the problems above.

1. **Operations are orchestrators, not implementors.** An operation function should read like a recipe: resolve inputs, call domain services, return results. 20-40 lines. If it needs comments explaining what a block does, that block is a missing abstraction.

2. **Compiler work belongs behind compiler adapters.** No operation should import from `ts-morph` or call `getProjectForFile()`. The compiler adapter owns all AST access.

3. **I/O goes through ports.** File reads, writes, existence checks, directory creation — all through an injectable `FileSystem` interface. This is the single biggest testability win.

4. **Plugins are self-contained feature folders.** The Vue plugin owns everything Vue-specific: project detection, compiler adapter, SFC scanning. Same pattern for future frameworks. Cross-cutting logic (import rewriting, workspace scoping) lives in shared domain services that plugins *use*, not duplicate.

5. **The workspace boundary is a first-class object**, not a string passed through six function signatures and checked ad-hoc in each loop.

---

## Target layer diagram

```
┌──────────────────────────────────────────────────────────┐
│                       Transport                          │
│                    MCP  ·  CLI  ·  Socket                │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│                       Dispatcher                         │
│            schema validation · workspace gate            │
│            provider resolution · post-op diags           │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│                       Operations                         │
│               thin orchestrators (20-40 LOC)             │
│                                                          │
│  rename · moveFile · moveSymbol · deleteFile             │
│  extractFunction · findReferences · getDefinition        │
│  searchText · replaceText · getTypeErrors                │
└──────┬─────────────────────┬─────────────────────────────┘
       │                     │
       │        ┌────────────▼─────────────┐
       │        │      Domain Services     │
       │        │                          │
       │        │  WorkspaceScope          │
       │        │  ImportRewriter          │
       │        │  SymbolRef               │
       │        └────┬───────────────┬─────┘
       │             │               │
┌──────▼─────────────▼───┐   ┌───────▼───────────────────┐
│    Compiler Adapters   │   │         Ports              │
│                        │   │                            │
│  TsMorphCompiler       │   │  FileSystem                │
│  ┌──────────────────┐  │   │    ├ NodeFileSystem        │
│  │ plugins/vue/     │  │   │    └ InMemoryFileSystem    │
│  │  VolarCompiler   │  │   │                            │
│  │  scan.ts         │  │   │                            │
│  └──────────────────┘  │   │                            │
└────────────────────────┘   └───────────────────────────┘
```

**Data flows down. Dependencies point down and inward.** Operations depend on domain services and compiler adapters. Compiler adapters depend on ports. Nothing depends on operations.

---

## Layer details

### Operations (thin orchestrators)

Each operation becomes a short orchestration sequence. Compare current vs. target for `moveSymbol`:

**Current (220 lines):**
```
resolve paths → manually find symbol in AST → manually prepare dest file →
manually walk project for importers → manually do AST surgery →
manually rewrite each importer → manually save files → call afterSymbolMove hook
```

**Target (~30 lines):**
```typescript
export async function moveSymbol(
  compiler: Compiler,
  sourceFile: string,
  symbolName: string,
  destFile: string,
  scope: WorkspaceScope,
  options?: { force?: boolean },
): Promise<MoveSymbolResult> {
  const absSource = assertFileExists(sourceFile, scope.fs);
  const absDest = scope.fs.resolve(destFile);

  // Compiler does the heavy lifting
  await compiler.moveSymbol(absSource, symbolName, absDest, scope, options);

  return {
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    symbolName,
    sourceFile: absSource,
    destFile: absDest,
  };
}
```

Same shape as `moveFile` today. The compiler adapter owns all AST work.

### Domain services

#### `WorkspaceScope`

Replaces the repeated pattern of `workspace: string` + `Set<modified>` + `Set<skipped>` + `isWithinWorkspace` checks.

```typescript
class WorkspaceScope {
  readonly root: string;
  readonly fs: FileSystem;
  private _modified = new Set<string>();
  private _skipped = new Set<string>();

  constructor(root: string, fs: FileSystem) { ... }

  /** Is this path within the workspace boundary? */
  contains(filePath: string): boolean { ... }

  /** Record a file as modified (must be within workspace). */
  recordModified(filePath: string): void { ... }

  /** Record a file as skipped (outside workspace). */
  recordSkipped(filePath: string): void { ... }

  /** Write a file, recording it as modified. Rejects out-of-workspace. */
  writeFile(filePath: string, content: string): void { ... }

  get modified(): string[] { return [...this._modified]; }
  get skipped(): string[] { return [...this._skipped]; }
}
```

Every operation and compiler adapter receives a `WorkspaceScope` instead of a raw `workspace: string`. The scope tracks what happened during the operation. No more manual Set bookkeeping.

#### `ImportRewriter`

Collapses the three implementations of import rewriting into one. Used by `TsMorphCompiler.moveSymbol` (in-project), `TsMorphCompiler.afterSymbolMove` (out-of-project fallback), and `plugins/vue/scan.ts` (SFC script blocks).

```typescript
class ImportRewriter {
  constructor(private fs: FileSystem) {}

  /**
   * Rewrite imports/re-exports of `symbolName` from `oldSource` to `newSource`
   * across a set of files. Handles partial moves (multi-symbol imports),
   * full moves, and re-export declarations.
   */
  rewrite(
    files: Iterable<string>,
    symbolName: string,
    oldSource: string,
    newSource: string,
    scope: WorkspaceScope,
  ): void { ... }
}
```

The TS compiler adapter calls this with ts-morph source files. The Vue plugin calls it with `.vue` SFC script content (parsed to a temporary AST). The logic is identical — only the file source differs, and that's abstracted behind `FileSystem`.

#### `SymbolRef`

Value object that encapsulates "an exported symbol in a file." Replaces the inline `Removable` type alias and the duplicated declaration-to-statement resolution.

```typescript
class SymbolRef {
  readonly filePath: string;
  readonly name: string;
  readonly declarationText: string;

  /** Remove this symbol's declaration from its source file. */
  remove(): void { ... }

  /** Whether this is a direct export (not a re-export via `export { }`). */
  isDirectExport(): boolean { ... }
}
```

### Compiler adapters (renamed from providers)

The current `providers/` folder becomes `compilers/`. The `LanguageProvider` interface splits into:

**`Compiler`** — the full interface that operations consume:

```typescript
interface Compiler {
  // Queries (unchanged from current LanguageProvider)
  resolveOffset(file: string, line: number, col: number): number;
  getRenameLocations(file: string, offset: number): Promise<SpanLocation[] | null>;
  getReferencesAtPosition(file: string, offset: number): Promise<SpanLocation[] | null>;
  getDefinitionAtPosition(file: string, offset: number): Promise<DefinitionLocation[] | null>;
  getEditsForFileRename(oldPath: string, newPath: string): Promise<FileTextEdit[]>;
  readFile(path: string): string;
  notifyFileWritten(path: string, content: string): void;

  // Compound operations (new — pulled out of operations layer)
  moveSymbol(
    source: string, symbolName: string, dest: string,
    scope: WorkspaceScope, options?: { force?: boolean },
  ): Promise<void>;

  // Post-hooks (simplified — scope replaces workspace + alreadyModified)
  afterFileRename(oldPath: string, newPath: string, scope: WorkspaceScope): Promise<void>;
  afterSymbolMove(
    source: string, symbolName: string, dest: string, scope: WorkspaceScope,
  ): Promise<void>;
}
```

**Key change:** `moveSymbol` is now a method on the compiler adapter, not a standalone function that reaches past the abstraction. The compiler adapter uses `ImportRewriter` and `SymbolRef` internally — those are shared domain services, not duplicated inline.

**Plugin structure stays the same:**

```
src/compilers/
  ts.ts                    ← TsMorphCompiler (renamed from TsProvider)

src/plugins/
  vue/
    plugin.ts              ← unchanged — LanguagePlugin factory
    compiler.ts            ← VolarCompiler (renamed from VolarProvider)
    scan.ts                ← unchanged — uses ImportRewriter internally
    service.ts             ← unchanged
```

Vue things stay in `plugins/vue/`. TS things stay in `compilers/ts.ts`. The shared domain services (`ImportRewriter`, `WorkspaceScope`, `SymbolRef`) live in a new `src/domain/` folder — they're framework-agnostic.

### Ports

#### `FileSystem`

```typescript
interface FileSystem {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  exists(path: string): boolean;
  mkdir(path: string, options?: { recursive?: boolean }): void;
  rename(oldPath: string, newPath: string): void;
  unlink(path: string): void;
  realpath(path: string): string;
  resolve(...segments: string[]): string;
}
```

Two implementations:

- **`NodeFileSystem`** — wraps `node:fs`. Used in production. One instance per daemon.
- **`InMemoryFileSystem`** — backed by a `Map<string, string>`. Used in tests. No temp directories, no cleanup, no fixture copying. Tests become ~50% shorter.

The `FileSystem` is injected into `WorkspaceScope`, compiler adapters, and any utility that touches disk. Current direct `fs` calls are replaced incrementally — no big-bang rewrite needed.

---

## What changes, what doesn't

| Component | Changes? | Notes |
|-----------|----------|-------|
| Transport (MCP, CLI, socket) | No | |
| Dispatcher | Minor | Passes `WorkspaceScope` instead of `workspace: string` |
| Operations | Yes | Become thin orchestrators; lose all inline compiler/fs logic |
| `providers/` → `compilers/` | Rename + absorb | Gains compound operation methods (moveSymbol, etc.) |
| `plugins/vue/` | Minor renames | `provider.ts` → `compiler.ts`; uses shared `ImportRewriter` |
| Domain services | **New layer** | `WorkspaceScope`, `ImportRewriter`, `SymbolRef` |
| `FileSystem` port | **New** | Injectable; replaces all direct `fs` calls |
| `security.ts` | Shrinks | `isWithinWorkspace` moves into `WorkspaceScope` |
| Utils | Unchanged | `text-utils`, `file-walk`, `ts-project`, `extensions` stay |

---

## Dependency graph

```
                Operations
               /    |     \
              /     |      \
  WorkspaceScope  ImportRewriter  SymbolRef     ← domain services
        |            |               |
        |       ┌────┘               |
        ▼       ▼                    ▼
     Compiler adapters                          ← TsMorphCompiler, VolarCompiler
        |
        ▼
     FileSystem port                            ← NodeFileSystem, InMemoryFileSystem
```

**No circular dependencies.** Domain services depend on the `FileSystem` port. Compiler adapters depend on domain services and `FileSystem`. Operations depend on everything above. Nothing depends on operations.

---

## Migration sequence

Each step is a standalone PR that leaves the codebase working. No big-bang rewrite.

### Step 1: Extract `FileSystem` port
- Define the interface + `NodeFileSystem` + `InMemoryFileSystem`
- Wire into one operation (`rename` — simplest) as proof of concept
- Tests for `rename` switch to `InMemoryFileSystem`

### Step 2: Extract `WorkspaceScope`
- Replace `workspace: string` + `Set<modified>` + `Set<skipped>` pattern
- Migrate `rename`, `moveFile` first
- Every operation gains consistent boundary tracking

### Step 3: Move `moveSymbol` compiler work into `TsMorphCompiler`
- `TsMorphCompiler.moveSymbol()` absorbs the current inline AST surgery
- `moveSymbol` operation becomes a thin orchestrator
- Tests split: compiler adapter tests (unit, in-memory FS) vs. operation tests (integration)

### Step 4: Extract `ImportRewriter`
- Shared service used by `TsMorphCompiler.moveSymbol`, `TsMorphCompiler.afterSymbolMove`, and `plugins/vue/scan.ts`
- Collapses the three implementations into one
- Unit-testable with `InMemoryFileSystem`

### Step 5: Rename `providers/` → `compilers/`, `LanguageProvider` → `Compiler`
- Pure rename — no logic changes
- Do this last to minimise diff noise in earlier PRs

### Step 6: Extract `SymbolRef`
- Value object for "exported symbol in a file"
- Eliminates inline `Removable` type and duplicated statement resolution
- Can happen any time after step 3

---

## What this unlocks

1. **Unit testing without the filesystem.** Domain services and compiler adapter logic become testable with `InMemoryFileSystem`. Test setup drops from "copy fixture to temp dir, write tsconfig, instantiate provider" to "create InMemoryFileSystem with three files."

2. **Composable operations.** "Move multiple symbols" or "split file" becomes composition of `SymbolRef` + `ImportRewriter` + `WorkspaceScope`, not a new 200-line function.

3. **Cleaner plugin boundary.** Plugins implement `Compiler` and use shared domain services. No more reaching past the abstraction to get `ts-morph` internals.

4. **Smaller test files.** The 786-line moveSymbol test suite splits into: compiler adapter tests (symbol resolution, import rewriting — unit tests with in-memory FS) + operation tests (orchestration — thin integration tests). Each file stays well under 300 lines.

5. **New frameworks for free.** A Svelte plugin implements `Compiler`, uses `ImportRewriter` and `WorkspaceScope`, and gets workspace boundary enforcement, modified/skipped tracking, and import rewriting without reimplementing any of it.
