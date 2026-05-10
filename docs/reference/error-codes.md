# Error codes

Every failed tool call returns `{ "status": "error", "error": "<CODE>", "message": "..." }`. Branch on `error`, never on `message`.

## Validation and input

| Code | Meaning | Retry? |
| --- | --- | --- |
| `VALIDATION_ERROR` | Input failed Zod schema validation (wrong type, missing field, bad regex for an identifier). | No — fix the input. |
| `INVALID_PATH` | Path string is malformed (empty, contains null bytes, etc.). | No — fix the path. |
| `PARSE_ERROR` | Malformed request payload, or invalid regex passed to `search-text`/`replace-text`. | No — fix the payload or regex. |
| `REDOS` | Regex was rejected by `safe-regex2` as ReDoS-prone (star-height > 1). | No — rewrite the regex. |

## Workspace and filesystem

| Code | Meaning | Retry? |
| --- | --- | --- |
| `WORKSPACE_VIOLATION` | Input path resolved outside the workspace boundary. | No. |
| `SENSITIVE_FILE` | Operation targeted a sensitive file (`.env`, key, certificate). Surgical `replace-text` raises this; pattern mode silently skips. | No. |
| `FILE_NOT_FOUND` | Source file does not exist on disk. | No — verify the path; consider whether a previous operation already moved or deleted it. |
| `NOT_A_DIRECTORY` | `move-directory` source path exists but is not a directory. | No. |
| `DESTINATION_EXISTS` | `move-file`/`move-directory` destination already exists (file) or is a non-empty directory. | No. |
| `MOVE_INTO_SELF` | `move-directory` destination is inside the source directory. | No. |

## Symbols and refactoring

| Code | Meaning | Retry? |
| --- | --- | --- |
| `SYMBOL_NOT_FOUND` | No renameable/movable symbol at the specified position. | No — verify position. |
| `SYMBOL_EXISTS` | `move-symbol` destination already declares a same-named symbol. | Retry with `force: true` to overwrite. |
| `RENAME_NOT_ALLOWED` | The symbol cannot be renamed (built-in identifier, string literal). | No. |
| `TEXT_MISMATCH` | Surgical `replace-text` `oldText` did not match the file at the given position. | No — re-read the file or re-run `search-text` to refresh positions. |
| `NOT_SUPPORTED` | The operation shape is not supported (e.g. `extract-function` on Vue without `<script setup>`, `move-symbol` on a re-export, selection that doesn't cover complete statements). | No. |

## Daemon and protocol

| Code | Meaning | Retry? |
| --- | --- | --- |
| `DAEMON_STARTING` | The daemon is still loading the project graph. | **Yes** — retry shortly. |
| `UNKNOWN_METHOD` | The daemon does not implement the requested method (version mismatch). | No — restart the daemon to pick up the new version. |
| `INTERNAL_ERROR` | Unexpected server-side failure. | Maybe — check daemon logs (`--verbose`). |

## Per-command code lists

The set of codes a given command can return is documented on its [command page](../commands/). The list above is the full vocabulary — most commands only emit a small subset.
