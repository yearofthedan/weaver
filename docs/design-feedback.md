# Design Feedback

Code review findings from a senior-engineer perspective. Issues are grouped by category and ordered by impact.

---

## Duplication

### 1. `offsetToLineCol` and its inverse live in separate files

`text-utils.ts` has `offsetToLineCol` (offset → line/col). `volar.ts` has `resolveOffset` (line/col → offset) as a private method. Neither knows the other exists.

**Fix:** Move `resolveOffset` logic to `text-utils.ts` as `lineColToOffset`, keeping both conversion directions in one place.

---

## Unnecessary Complexity

### 2. `translateLocations` in `volar.ts` has 4 levels of nesting with repeated fallback logic

Three separate early-continue branches all execute the same `locations.push(...)` fallback. The nesting makes the control flow hard to follow at a glance.

**Fix:** Extract `translateSingleLocation(loc, service): T | null` — each branch returns a value or `null`. The outer function becomes a `.map().filter(Boolean)`.

---

### 3. `buildVolarService` in `vue-service.ts` is 176 lines doing 8 distinct things

In sequence: library imports, file-contents map, tsconfig parsing, file collection, Volar language setup, virtual-path mapping, service-host creation, service decoration. It works but is at the upper limit of readability and is effectively untestable at the unit level.

**Fix:** Extract named sub-functions for each phase. The top-level function orchestrates; each sub-function is independently readable and testable.

---

## Dead / Redundant Code

### 4. `format()` methods in `dispatcher.ts` compute a `message` field that is never used

Every operation descriptor builds a human-readable message string. `mcp.ts` never surfaces it to clients — it is computed and discarded on every call.

**Fix:** Decide the intent. If the message is not for clients, delete the `format()` methods. If it is for clients, wire it through the protocol response.

---

## Suggested Fix Order

| Priority | Issue | Effort | Status |
|---|---|---|---|
| 1 | Move `lineColToOffset` to `text-utils.ts` | Small | Done |
| 2 | Flatten `translateLocations` with a helper | Medium | Done |
| 3 | Remove dead `message` field in dispatcher | Small | |
| 4 | Break up `buildVolarService` | Medium | |
