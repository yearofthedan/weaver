# Internals: replace-text

User-facing reference: [docs/commands/replace-text.md](../commands/replace-text.md).

## How it works

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  ▼ replaceText() (src/operations/replaceText.ts)
  │
  ├─ Pattern mode
  │     validate pattern with safe-regex2 (same ReDoS protection as searchText)
  │     discover files: walkWorkspaceFiles() → glob filter, then excludeGlob filter
  │     per file: skip if isWithinWorkspace fails or isSensitiveFile; apply regex replace-all
  │     write changed files
  │
  └─ Surgical mode
        validate all edits up front (isWithinWorkspace, isSensitiveFile, oldText match at position)
        if any validation fails: throw immediately — no files are modified
        sort edits within each file descending by position (last-to-first application)
        apply edits; write changed files
  │
  ▼ dispatcher appends type errors for filesModified (unless checkTypeErrors: false)
  ▼ result { ok, filesModified, filesSkipped, replacementCount, typeErrors }
```

## Technical decisions

**Why two modes in one tool instead of separate tools?**
Both modes serve the same user intent (change text in files) and share security enforcement, file I/O, and post-write type checking. Splitting them would duplicate the interface surface and force agents to learn two tools for one concept.

**Why does surgical mode fail atomically instead of skipping bad edits?**
Surgical edits are precise — the caller knows exactly what should change. A mismatch means the caller's model of the file is wrong, and applying other edits from that same model is likely to produce corrupt output. Failing fast is safer than partial application.

**Why `oldText` verification instead of just position-based replacement?**
Position-only edits are brittle — if the file changed between `searchText` and `replaceText` (e.g. another operation ran), the position may now point at different text. `oldText` verification catches this drift and fails with a clear error rather than silently corrupting the file.

**Why apply surgical edits last-to-first within a file?**
Applying an edit shifts all byte offsets after it. Applying the last edit first keeps all earlier offsets valid for subsequent edits in the same file.
