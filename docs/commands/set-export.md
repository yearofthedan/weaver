# set-export

Add or remove the `export` keyword on a top-level declaration. Removing it is refused when another file still references the symbol.

## When to use

- A helper has outgrown its module and other files need it.
- A symbol is exported but only ever used where it is declared, and you want the module's surface to say so.

The compiler resolves the declaration by name, so the call is the same for every declaration form — no per-form regex, and a name that does not resolve is reported rather than silently skipped.

## Synopsis

```bash
weaver set-export '{"file":"src/utils.ts","symbolName":"formatDate","exported":true}'
```

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | string | yes | `.ts`/`.tsx` file containing the declaration. Inside the workspace. |
| `symbolName` | string | yes | Name of a **top-level** declaration. Valid JS/TS identifier. |
| `exported` | boolean | yes | `true` adds the keyword, `false` removes it. |
| `checkTypeErrors` | boolean | no | Default `true`. Run post-write type diagnostics. |

## Output

```json
{
  "status": "success",
  "filesModified": ["src/utils.ts"],
  "filesSkipped": [],
  "symbolName": "formatDate"
}
```

| Field | Description |
| --- | --- |
| `symbolName` | Echo of the declaration's name. |
| `filesModified` | The target file, or empty when the declaration was already in the requested state. |
| `filesSkipped` | Always empty — a single workspace-validated file is written, or none. |

A declaration already in the requested state is a success with `filesModified: []`, and no `typeErrors` fields are attached. That empty-modified shape is what distinguishes "already done" from `SYMBOL_NOT_FOUND` when retrying a call.

See [response format](../reference/response-format.md).

## Error codes

`FILE_NOT_FOUND`, `SYMBOL_NOT_FOUND`, `SYMBOL_IN_USE`, `NOT_SUPPORTED`, `WORKSPACE_VIOLATION`, `INVALID_PATH`, `VALIDATION_ERROR`. See [error codes](../reference/error-codes.md).

`SYMBOL_IN_USE` means `exported: false` was asked for while other files reference the symbol. The message names them, capped at 10 with the true total. Remove those references first, then retry.

`NOT_SUPPORTED` covers: a `.vue` target file; a name that resolves only through a re-export (`export { foo } from "./other"`); a declaration exported only by a trailing `export { foo }` statement; a default export; a name shared by several top-level declarations, such as function overloads; and a name that is one declarator of a multi-declarator statement (`const a = 1, foo = 2`).

## Examples

Export a helper so another module can import it:

```bash
weaver set-export '{"file":"/repo/src/utils.ts","symbolName":"formatDate","exported":true}'
```

Un-export a symbol nothing outside the file uses:

```bash
weaver set-export '{"file":"/repo/src/utils.ts","symbolName":"pad","exported":false}'
```

Refused, because two files still import it:

```json
{
  "status": "error",
  "error": "SYMBOL_IN_USE",
  "message": "Symbol 'pad' in /repo/src/utils.ts is used by 2 other file(s); un-exporting it would break them: /repo/src/a.ts, /repo/src/b.ts"
}
```

## Limitations

- Supported declaration forms are `function`, `const`/`let`/`var`, `class`, `interface`, and `type`. An `enum` name reports `SYMBOL_NOT_FOUND`.
- Top-level declarations only. Function-locals, class members, and namespace members are invisible and report `SYMBOL_NOT_FOUND`.
- `.vue` targets return `NOT_SUPPORTED` — a top-level `export` is not valid inside an SFC script block. `.ts` files in a Vue project are fully supported, including detection of `.vue` files that import the symbol.
- A `.vue` script that reaches the symbol through a namespace import (`import * as u from "./utils"` then `u.pad()`) is **not** detected, so un-exporting will not be refused for it. Named imports and named re-exports from `.vue` scripts are detected. TypeScript files are covered for all three.
- References inside the declaring file never block removal; an unused named import in another file does.
- Removing an export does not remove now-dead imports elsewhere — that is what the refusal exists to prevent.

→ Internals: [docs/internals/set-export.md](../internals/set-export.md)
