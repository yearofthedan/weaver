# skills install

Copy the skill files shipped with the installed weaver package into a project's skills directory.

## When to use

- After installing `@yearofthedan/weaver` in a project, to make its skills discoverable by your agent host.
- To update the installed skills after upgrading weaver — the skills come from the installed package, so they always match the binary version.

## Synopsis

```bash
weaver skills install [--dir <path>] [--force]
```

## Flags

| Flag | Required | Description |
| --- | --- | --- |
| `--dir <path>` | no | Destination skills directory. Skills are written as `<dir>/<name>/SKILL.md`. Defaults to `<cwd>/.claude/skills` (Claude Code's discovery path). |
| `--force` | no | Overwrite a destination skill that has diverged from the shipped version. Without it, diverged files are left untouched and reported. |

## Output

Human-readable summary, one line per shipped skill:

```
installed weaver-refactor → .claude/skills/weaver-refactor/SKILL.md
up-to-date weaver-code-inspection
skipped weaver-search-and-replace (diverged; use --force to overwrite)
overwritten weaver-refactor
```

| Line | Meaning |
| --- | --- |
| `installed <name> → <path>` | The skill was not present at the destination and was written. |
| `up-to-date <name>` | The destination copy is byte-identical to the shipped version; nothing written. |
| `skipped <name> (diverged; use --force to overwrite)` | A destination copy exists but differs, and `--force` was not given; left unchanged. |
| `overwritten <name>` | A diverged destination copy was replaced with the shipped version (`--force`). |

## Behavior

- The set of skills installed is derived from the package's own `package.json` `files` array (the npm tarball manifest), so only the skills weaver actually ships are copied.
- Re-running with no changes writes nothing — every skill reports `up-to-date`.
- Creates the destination directory tree as needed.
- Writes only the SKILL.md files; it does not modify any other project files.
- Exit code `0` on success.

## Limitations

- `--dir` changes only the *location*. The files are copied verbatim as `SKILL.md`, so hosts that expect a different rule format (e.g. Cursor `.mdc`) will not consume them as-is.

→ Internals: [docs/internals/daemon.md](../internals/daemon.md) (CLI/daemon overview)
