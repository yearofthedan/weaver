# moveSymbol: class method extraction

**type:** change
**date:** 2026-03-02
**tracks:** handoff.md # moveSymbol for class methods → docs/features/moveSymbol.md

---

## Context

`moveSymbol` currently only handles top-level exported declarations (`export function`, `export const`, `export class`). The handoff entry asks for class method extraction: pull a method out of a class and place it in another file as a standalone exported function. This is a common refactoring when decomposing large classes or migrating from OOP to functional style.

## Value / Effort

- **Value:** Agents refactoring large classes currently have no way to safely extract a method through the engine — they'd need to manually read the method body, write it to the destination, delete it from the class, and hope they got the text manipulation right. This operation provides correct AST-level extraction with proper function signature synthesis. The tool rejects `this`-dependent methods upfront, preventing agents from creating broken code.
- **Effort:** Moderate. The implementation surface is:
  - `src/operations/moveSymbol.ts` — new branch for dotted `symbolName` (e.g. `ClassName.methodName`); find class → find method → extract text → synthesize standalone function → remove method from class → append to destination.
  - `src/schema.ts` — relax `symbolName` regex to allow one dot (e.g. `Foo.bar`).
  - `src/mcp.ts` — update tool description to mention class method support.
  - No new infrastructure; follows existing `moveSymbol` patterns (same result type, same response shape, same workspace boundary enforcement).
  - Call-site rewriting is **out of scope** — agents use `replaceText` or `rename` for that. This keeps effort manageable.

## Behaviour

- [ ] **AC1 — Static method extraction:** Given `sourceFile` containing `export class Foo { static bar(x: number): number { return x + 1; } }` and `symbolName` = `"Foo.bar"`, the method is removed from the class and appended to `destFile` as `export function bar(x: number): number { return x + 1; }`. The `static` keyword is stripped. The class remains in `sourceFile` (minus the method).

- [ ] **AC2 — Instance method without `this`:** Given a class with `doWork(n: number): number { return n * 2; }` (no `this` references in the body), `symbolName` = `"ClassName.doWork"` extracts it as `export function doWork(n: number): number { return n * 2; }` and removes it from the class.

- [ ] **AC3 — Reject method that references `this`:** Given a method whose body contains `this.` references, the operation throws `EngineError` with code `NOT_SUPPORTED` and a message explaining that methods referencing `this` cannot be extracted.

- [ ] **AC4 — Class or method not found:** If the class name doesn't match any exported class in `sourceFile`, or the method name doesn't exist on the matched class, throws `EngineError` with code `SYMBOL_NOT_FOUND`.

- [ ] **AC5 — Preserves existing moveSymbol behaviour:** A non-dotted `symbolName` (e.g. `"greetUser"`) continues to work exactly as before — the new code path only activates when `symbolName` contains a dot.

## Interface

**Parameter change — `symbolName`:**

- Current: validated as `[a-zA-Z_$][a-zA-Z0-9_$]*` (simple identifier)
- New: also accepts `ClassName.methodName` (exactly one dot, both segments valid identifiers)
- Regex: `/^[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z_$][a-zA-Z0-9_$]*)?$/`
- Example values: `"greetUser"` (top-level, existing), `"Calculator.add"` (class method, new)
- Zero case: empty string → rejected by `.min(1)` (unchanged)
- Adversarial: `"a.b.c"` (two dots) → rejected by regex; `".bar"` → rejected; `"Foo."` → rejected

**Return shape:** unchanged — `MoveSymbolResult` with `filesModified`, `filesSkipped`, `symbolName`, `sourceFile`, `destFile`. `symbolName` returns the full dotted name as provided (e.g. `"Foo.bar"`).

**Error codes (no new codes):**
- `SYMBOL_NOT_FOUND` — class not found, or method not on class
- `NOT_SUPPORTED` — method references `this`
- `FILE_NOT_FOUND` — sourceFile doesn't exist (existing)

**MCP tool description update:** Remove "does not support class methods" and add: "For class methods, use dotted notation: 'ClassName.methodName'. The method is extracted as a standalone exported function. Methods that reference 'this' are rejected."

## Edges

- The class itself must be an exported class (`export class`). A method on a non-exported class is rejected with `SYMBOL_NOT_FOUND` (consistent with existing behaviour that requires the parent to be exported).
- Extracting from a class with a single method should leave an empty class body, not delete the class.
- Private/protected methods: accepted if they pass the `this` check — visibility modifiers are stripped in the standalone function (it's exported, so it's public).
- `async` methods: the `async` keyword must be preserved on the extracted function.
- Generator methods (`*foo()`): the `*` must be preserved.
- The method's type parameters, parameter types, and return type must be preserved verbatim.
- This does NOT update call sites — if code calls `instance.doWork()`, those calls are not rewritten. The agent handles call-site updates separately.
- Workspace boundary enforcement: unchanged — same guards as existing `moveSymbol`.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated:
      - `docs/features/moveSymbol.md` — add class method row to file-type table, update constraints
      - `src/mcp.ts` tool description updated
      - `README.md` — only if the tool table entry changes
      - `docs/handoff.md` current-state section — no layout change needed
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Agent insights captured in docs/agent-memory.md
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
