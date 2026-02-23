# Design Feedback

Code review findings from a senior-engineer perspective. Issues are grouped by category and ordered by impact.

---

## Duplication

### 1. Cache key formula repeated 4× in `volar.ts` ✅ Done

The expression `` tsConfigPath ?? `__no_tsconfig__:${path.dirname(filePath)}` `` is inlined at lines 14, 25, 173, and 179. If the format ever changes, all four sites must be updated consistently.

**Fix:** Extract a private `cacheKey(tsConfigPath, filePath)` helper method on `VolarProvider`.

---

### 2. File-not-found guard copy-pasted across three operations ✅ Done

`rename.ts:18–20`, `moveFile.ts:17–19`, and `moveSymbol.ts:34–36` each contain:

```typescript
const absPath = path.resolve(filePath);
if (!fs.existsSync(absPath)) throw new EngineError(`File not found: ...`, "FILE_NOT_FOUND");
```

**Fix:** Add `assertFileExists(filePath): string` to `src/utils/` — resolve, check, throw, return the absolute path.

---

### 3. Relative import path computed three different ways ✅ Done

`moveSymbol.ts:9–12` has a standalone `computeRelativeSpecifier` function. `vue-scan.ts` reimplements the same logic inline at two locations (~line 60 and ~line 143), with slightly different Windows separator handling. The three implementations can silently diverge.

**Fix:** One canonical `computeRelativeImportPath(fromFile, toFile)` utility in `src/utils/`, used by all callers.

---

### 4. `offsetToLineCol` and its inverse live in separate files

`text-utils.ts` has `offsetToLineCol` (offset → line/col). `volar.ts` has `resolveOffset` (line/col → offset) as a private method. Neither knows the other exists.

**Fix:** Move `resolveOffset` logic to `text-utils.ts` as `lineColToOffset`, keeping both conversion directions in one place.

---

## Unnecessary Complexity

### 5. `translateLocations` in `volar.ts` has 4 levels of nesting with repeated fallback logic

Three separate early-continue branches all execute the same `locations.push(...)` fallback. The nesting makes the control flow hard to follow at a glance.

**Fix:** Extract `translateSingleLocation(loc, service): T | null` — each branch returns a value or `null`. The outer function becomes a `.map().filter(Boolean)`.

---

### 6. `buildVolarService` in `vue-service.ts` is 176 lines doing 8 distinct things

In sequence: library imports, file-contents map, tsconfig parsing, file collection, Volar language setup, virtual-path mapping, service-host creation, service decoration. It works but is at the upper limit of readability and is effectively untestable at the unit level.

**Fix:** Extract named sub-functions for each phase. The top-level function orchestrates; each sub-function is independently readable and testable.

---

## Dead / Redundant Code

### 7. `format()` methods in `dispatcher.ts` compute a `message` field that is never used

Every operation descriptor builds a human-readable message string. `mcp.ts` never surfaces it to clients — it is computed and discarded on every call.

**Fix:** Decide the intent. If the message is not for clients, delete the `format()` methods. If it is for clients, wire it through the protocol response.

---

### 8. Runtime guard in `replaceText.ts` is already covered by Zod ✅ Done

The `EngineError` thrown at `replaceText.ts:41–44` is unreachable — `schema.ts` validates the same condition via `.refine()` before the function is ever called.

**Fix:** Remove the redundant runtime check, or add a comment explaining why it exists as a second line of defence.

---

## Validation Gap

### 9. `ReplaceTextArgsSchema` allows both modes simultaneously ✅ Done

The `.refine()` checks that at least one mode is present, but not that only one is. A client can send both `pattern`+`replacement` and `edits` together; the code silently picks `edits` first. The intent is clearly "one or the other."

**Fix:** Enforce mutual exclusivity in the refine:

```typescript
.refine(
  (d) => {
    const hasPattern = d.pattern !== undefined && d.replacement !== undefined;
    const hasEdits = d.edits !== undefined;
    return hasPattern !== hasEdits; // XOR
  },
  { message: "Provide either 'pattern'+'replacement' or 'edits', not both" },
)
```

---

## Suggested Fix Order

| Priority | Issue | Effort | Status |
|---|---|---|---|
| 1 | Shared `assertFileExists` utility | Small | ✅ Done |
| 2 | Shared `computeRelativeImportPath` utility | Small | ✅ Done |
| 3 | `volar.ts` cache key helper | Trivial | ✅ Done |
| 4 | `lineColToOffset` moved to `text-utils.ts` | Small | |
| 5 | Flatten `translateLocations` with a helper | Medium | |
| 6 | Remove dead `message` field in dispatcher | Small | |
| 7 | Comment on unreachable guard in `replaceText.ts` | Trivial | ✅ Done |
| 8 | Fix Zod XOR validation for `ReplaceTextArgs` | Trivial | ✅ Done |
| 9 | Break up `buildVolarService` | Medium | |
