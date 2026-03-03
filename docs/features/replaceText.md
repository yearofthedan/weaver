# Feature: replaceText

**Purpose:** Edit text across workspace files — pattern mode for broad find-and-replace, surgical mode for exact position-verified edits.

Works on arbitrary text (not just language-level symbols like `rename`). Enforces workspace boundaries, skips sensitive files, and returns post-write type errors.

**Pattern mode** — regex replace-all across the workspace:

```json
{
  "name": "replaceText",
  "arguments": {
    "pattern": "oldImportPath",
    "replacement": "newImportPath",
    "glob": "**/*.ts"
  }
}
```

**Surgical mode** — exact position-verified edits fed from `searchText` output:

```json
{
  "name": "replaceText",
  "arguments": {
    "edits": [
      {
        "file": "/path/to/project/src/utils.ts",
        "line": 5,
        "col": 10,
        "oldText": "calculateTotal",
        "newText": "computeTotal"
      }
    ]
  }
}
```

Exactly one mode must be provided — `pattern`+`replacement` or `edits`, not both. The response includes `replacementCount` (total replacements across all files) in addition to the standard fields. See [mcp-transport.md](./mcp-transport.md) for the full response contract.

## How it works

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  ▼ replaceText() (src/operations/replaceText.ts)
  │
  ├─ Pattern mode
  │     validate pattern with safe-regex2 (same ReDoS protection as searchText)
  │     discover files: walkWorkspaceFiles() → skip binary, skip sensitive
  │     per file: apply regex replace-all; skip if isWithinWorkspace fails or isSensitiveFile
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

## Security

- **Pattern mode:** each file is re-checked with `isWithinWorkspace()` (resolves symlinks) and `isSensitiveFile()` before writing. Files that fail either check are silently skipped.
- **Surgical mode:** all edits are validated up front — `isWithinWorkspace()` and `isSensitiveFile()` are checked per edit before any file is touched. Violations throw immediately.
- **Asymmetric failure:** pattern mode skips bad files silently (best-effort across many files); surgical mode fails atomically (precise edits should be exact).
- ReDoS protection: `safe-regex2` rejects catastrophic-backtracking patterns in pattern mode.

See [security.md](../security.md) for the full threat model.

## Constraints

- Pattern mode uses ECMAScript regex syntax — same constraints as `searchText`.
- Pattern mode replaces all matches in all files with no per-file or per-match confirmation. Use `searchText` first to preview what will change.
- Surgical mode validates all edits up front before writing any file. If any edit fails validation, no files are modified.
- Surgical edits within the same file must not overlap — overlapping ranges produce undefined results.
- Post-write type checking only covers `.ts`/`.tsx` files. `.vue` and other file types in `filesModified` are silently skipped for type checking.
- Sensitive files (`.env`, keys, certs) are skipped in pattern mode and rejected in surgical mode.

## Technical decisions

**Why two modes in one tool instead of separate tools?**
Both modes serve the same user intent (change text in files) and share security enforcement, file I/O, and post-write type checking. Splitting them would duplicate the interface surface and force agents to learn two tools for one concept.

**Why does surgical mode fail atomically instead of skipping bad edits?**
Surgical edits are precise — the caller knows exactly what should change. A mismatch means the caller's model of the file is wrong, and applying other edits from that same model is likely to produce corrupt output. Failing fast is safer than partial application.

**Why `oldText` verification instead of just position-based replacement?**
Position-only edits are brittle — if the file changed between `searchText` and `replaceText` (e.g. another operation ran), the position may now point at different text. `oldText` verification catches this drift and fails with a clear error rather than silently corrupting the file.

**Why apply surgical edits last-to-first within a file?**
Applying an edit shifts all byte offsets after it. Applying the last edit first keeps all earlier offsets valid for subsequent edits in the same file.
