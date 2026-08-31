**Purpose:** Reference index for every weaver command.
**Audience:** Anyone evaluating, integrating, or scripting weaver.

---

# Commands

Each command page follows the same structure: **When to use**, **Synopsis**, **Inputs**, **Output**, **Error codes**, **Examples**, **Limitations**, and a link to internals.

All operation commands accept JSON over CLI argument or stdin and return JSON on stdout.

## Refactoring

| Command | Summary | TS | Vue |
| :--- | :--- | :--- | :---: |
| [`rename`](./rename.md) | Rename a symbol and every reference project-wide. | ✓ | ✓ |
| [`move-file`](./move-file.md) | Move a file and rewrite affected imports. | ✓ | ✓ |
| [`move-directory`](./move-directory.md) | Move a directory and rewrite affected imports. | ✓ | ✓ |
| [`move-symbol`](./move-symbol.md) | Move a named export to another file. | ✓ | ✓\* |
| [`delete-file`](./delete-file.md) | Delete a file and remove its references. | ✓ | ✓† |
| [`extract-function`](./extract-function.md) | Extract a code block into a module-scope function. | ✓ | ✓‡ |
| [`set-export`](./set-export.md) | Add or remove `export` on a top-level declaration. | ✓ | ✓§ |

\* `move-symbol` moves exports from `.ts`/`.tsx` sources and updates `.vue` importers. Moving from a `.vue` source is not yet supported.
† `delete-file` cleans `.vue` SFC `<script>` blocks via regex scan.
‡ `extract-function` supports `.vue` files with a `<script setup>` block; Options API `<script>` returns `NOT_SUPPORTED`.
§ `set-export` changes `.ts`/`.tsx` declarations and returns `NOT_SUPPORTED` for a `.vue` target, where a top-level `export` is not valid; `.vue` files importing the symbol are detected when un-exporting.

## Code inspection

| Command | Summary | TS | Vue |
| :--- | :--- | :--- | :---: |
| [`find-references`](./find-references.md) | Every reference to a symbol. | ✓ | ✓ |
| [`find-importers`](./find-importers.md) | Every file that imports a given file. | ✓ | ✓ |
| [`get-definition`](./get-definition.md) | Definition location(s) for a symbol. | ✓ | ✓ |
| [`get-type-errors`](./get-type-errors.md) | Project-wide or per-file TypeScript errors. | ✓ | ✓ |

## Search and replace

| Command | Summary |
| :--- | :--- |
| [`search-text`](./search-text.md) | Regex search across the workspace with glob filtering. |
| [`replace-text`](./replace-text.md) | Regex replace-all or position-verified surgical edits. |

## Setup

| Command | Summary |
| :--- | :--- |
| [`skills install`](./skills-install.md) | Copy the shipped skill files into a project's skills directory. |

## Lifecycle

| Command | Summary |
| :--- | :--- |
| [`daemon`](./daemon.md) | Start the long-lived engine host for a workspace. |
| [`stop`](./stop.md) | Stop the daemon for a workspace. |

## See also

- [Response format](../reference/response-format.md) — `status` field, mutating vs read-only shapes, common fields.
- [Error codes](../reference/error-codes.md) — every code, what it means, and when it can occur.
- [Architecture](../architecture.md) — provider/operation/dispatcher design.
