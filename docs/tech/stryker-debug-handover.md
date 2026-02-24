# Stryker Mutation Testing — Scope Decision

**Date:** 2026-02-24
**Status:** Resolved — scoped to security + utils only.

---

## Decision

Stryker's vitest-runner (`pool: 'threads'`, `inPlace: true`) is incompatible with
any code that touches TypeScript's language service or ts-morph. TS's module-level
caches (`lineMap`, `ts.sys`, language service state) corrupt under Stryker's
worker-thread instrumentation, producing failures that don't reproduce under
normal vitest. Attempting to work around these failures means changing production
code to satisfy test infrastructure — a bad trade.

**Scope kept:** `src/security.ts`, `src/utils/{text-utils,file-walk,relative-path,assert-file}.ts`
— pure functions with deterministic behaviour.

**Scope dropped:** `src/operations/**/*.ts`, `src/providers/**/*.ts`, `src/utils/ts-project.ts`
— all depend on TypeScript's compiler/language-service internals.

---

## First run results (240 mutants, 77% killed)

Notable surviving mutants that reveal real test gaps:

| File | Mutant | Impact |
|---|---|---|
| `security.ts:137` | `if (fs.existsSync(abs))` → `if (false)` | Symlink-to-outside-workspace check has **no coverage** |
| `security.ts:36,57,73` | All sensitive-file sets → `[]` | No test fails when entire basename/extension/pattern lists are emptied |
| `security.ts:8` | `RESTRICTED_WORKSPACE_ROOTS` → `[]` | No test fails when restricted roots are emptied |
| `security.ts:93` | `.env` regex drops `^` anchor | `.env` pattern would match mid-filename |
| `text-utils.ts:22` | `>=` → `>` in bounds check | Off-by-one at exact line-count boundary not tested |
| `text-utils.ts:40` | `sort()` removed from `applyTextEdits` | Descending-order sort not exercised by any test |

The security survivors are the highest-value findings — these are the gaps
mutation testing exists to catch.

---

## How to run

```bash
npx stryker run              # full mutation run (~20s)
npx stryker run --dryRunOnly  # verify tests pass under Stryker without mutations
```
