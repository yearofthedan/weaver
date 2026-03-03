# Feature: replaceText

**Purpose:** Edit text across workspace files — pattern mode for broad find-and-replace, surgical mode for exact position-verified edits.

## What it does

Replaces text across workspace files in one of two modes. Works on arbitrary text (not just language-level symbols like `rename`). Enforces workspace boundaries, skips sensitive files, and returns post-write type errors.

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

**Surgical mode** — exact position-verified edits:

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

**Response (both modes):**

```json
{
  "ok": true,
  "filesModified": ["src/utils.ts", "src/app.ts"],
  "replacementCount": 3,
  "typeErrors": [],
  "typeErrorCount": 0,
  "typeErrorsTruncated": false
}
```

Exactly one mode must be provided — pattern+replacement or edits, not both.

## Key concepts

- **Two modes, one tool.** Pattern mode is for broad changes ("replace all occurrences of X with Y"). Surgical mode is for precise changes at known locations — feed it output from `searchText` to do a reviewed find-and-replace workflow.
- **Surgical verification.** In surgical mode, `oldText` is checked against the actual file content at the given position before writing. If the text doesn't match (stale edit, wrong position), the operation fails with `TEXT_MISMATCH` before any file is modified.
- **Edits applied last-to-first.** Surgical edits within a file are sorted by position descending so that earlier offsets remain valid as later ones are applied.
- **Post-write type checking.** After writes, type errors in every modified `.ts`/`.tsx` file are returned automatically. Pass `checkTypeErrors: false` to suppress.
- **ReDoS protection.** Pattern mode checks the regex with `safe-regex2` before execution, same as `searchText`.
- **Backreferences.** Pattern mode supports `$1`, `$2`, etc. in the replacement string for capture group substitution.

## Supported file types

| Scenario | Supported |
|----------|-----------|
| Any text file in the workspace (pattern mode) | Yes |
| Any file at a known path (surgical mode) | Yes |
| Binary files (pattern mode) | Skipped — `walkWorkspaceFiles` only returns text files |
| Sensitive files (`.env`, keys, certs) | Skipped (pattern mode) / rejected with `SENSITIVE_FILE` (surgical mode) |

## Constraints & limitations

- Pattern mode uses ECMAScript regex syntax, same constraints as `searchText`.
- Pattern mode replaces all matches in all files — there is no per-file or per-match confirmation. Use `searchText` first to preview what will change.
- Surgical mode validates all edits up front before writing any file. If any edit fails validation (workspace boundary, sensitive file, text mismatch), no files are modified.
- Surgical edits within the same file must not overlap — overlapping ranges produce undefined results.
- Post-write type checking only covers `.ts`/`.tsx` files. `.vue` and other file types in `filesModified` are silently skipped for type checking.

## Security & workspace boundary

- **Pattern mode:** each file is re-checked with `isWithinWorkspace()` (resolves symlinks) and `isSensitiveFile()` before writing. Files that fail either check are silently skipped.
- **Surgical mode:** all edits are validated up front — `isWithinWorkspace()` and `isSensitiveFile()` checked per edit before any file is touched. Violations throw immediately.
- **Asymmetric failure:** pattern mode skips bad files silently (best-effort across many files); surgical mode fails atomically (precise edits should be exact).

See `docs/security.md` for the full threat model.

## Technical decisions

**Why two modes in one tool instead of separate tools?**
Both modes serve the same user intent (change text in files) and share security enforcement, file I/O, and post-write type checking. Splitting them would duplicate the interface surface and force agents to learn two tools for one concept.

**Why does surgical mode fail atomically instead of skipping bad edits?**
Surgical edits are precise — the caller knows exactly what should change. A mismatch means the caller's model of the file is wrong, and applying other edits from that same model is likely to produce corrupt output. Failing fast is safer than partial application.

**Why `oldText` verification instead of just position-based replacement?**
Position-only edits are brittle — if the file changed between `searchText` and `replaceText` (e.g. another operation ran), the position may now point at different text. `oldText` verification catches this drift and fails with a clear error rather than silently corrupting the file.
