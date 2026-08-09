# move-file

Move a file and rewrite every import that references it, project-wide. The TypeScript language service computes the exact set of import paths that need updating; in Vue workspaces a post-scan patches `.vue` SFC imports.

## When to use

- Moving a `.ts`/`.tsx`/`.js`/`.jsx`/`.vue` file to a new path within the workspace.
- You want all importers updated automatically — both relative paths and path aliases.

Pick [`move-directory`](./move-directory.md) for a whole directory. Pick a plain `mv` only if no other file imports the moved file.

## Synopsis

```bash
weaver move-file '{"oldPath": "src/utils/helpers.ts", "newPath": "src/lib/helpers.ts"}'
```

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `oldPath` | string | yes | Current file location. Must be inside the workspace. |
| `newPath` | string | yes | Destination path. Must be inside the workspace. Must not exist. |
| `checkTypeErrors` | boolean | no | Default `true`. Run post-write type diagnostics on `filesModified`. |

## Output

```json
{
  "status": "success",
  "filesModified": ["src/lib/helpers.ts", "src/main.ts", "src/components/App.vue"],
  "filesSkipped": []
}
```

`filesModified` includes the moved file itself plus every file whose imports were rewritten. `filesSkipped` lists importers in the project graph that fell outside the workspace boundary. See [response format](../reference/response-format.md).

## Error codes

`FILE_NOT_FOUND`, `WORKSPACE_VIOLATION`, `DESTINATION_EXISTS`, `NOT_SUPPORTED`, `VALIDATION_ERROR`. See [error codes](../reference/error-codes.md).

## Examples

```bash
weaver move-file '{"oldPath": "/repo/src/old.ts", "newPath": "/repo/src/lib/new.ts"}'
```

## Limitations

- `newPath` must not already exist — no overwrite.
- Both paths must be inside the workspace.
- Dynamic `import()` calls with computed paths are not updated.
- Cross-type moves (`.ts` ↔ `.vue`) are rejected — semantic mismatch.

→ Internals: [docs/internals/move-file.md](../internals/move-file.md)
