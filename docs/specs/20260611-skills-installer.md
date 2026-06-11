# Built-in skills installer (`weaver skills install`)

**type:** change
**date:** 2026-06-11
**tracks:** handoff.md # Built-in skills installer (`weaver install`) → docs/commands/skills-install.md (new), README.md

---

## Context

Skills are currently distributed via `npx skills add yearofthedan/weaver` ([vercel-labs/skills](https://github.com/vercel-labs/skills)), which clones the skills from the GitHub repo's `main` branch. That decouples the skill content a user receives from the weaver *version* they installed: someone on `@yearofthedan/weaver@0.1.5` pulls whatever is on `main` today, which may describe commands or flags their installed binary lacks. MCP removal has shipped, so agent guidance now ships entirely through skills — making this skew the primary distribution risk. A built-in installer copies skills from the installed package itself (already shipped via the `files` array), so the skills always match the binary.

## User intent

*As someone setting up weaver in a project, I want a single command that copies weaver's skills into my agent host's skills directory, so that my agent discovers them and the skill content always matches my installed weaver version.*

## Relevant files

- `src/adapters/cli/cli.ts` — registers `daemon`/`stop` subcommands; the new `skills install` subcommand is registered here (sibling pattern).
- `src/adapters/cli/operations.ts` — data-driven subcommand registration reference; shows how subcommands render help and parse args.
- `src/ports/filesystem.ts` — `FileSystem` interface; the copy/diff logic depends on this port so it is unit-testable.
- `src/ports/in-memory-filesystem.ts` — `InMemoryFileSystem` for unit tests of the copy/diff function.
- `src/ports/node-filesystem.ts` — production `FileSystem`; the CLI command wires this in.
- `.claude/skills/{refactor,code-inspection,search-and-replace}/SKILL.md` — the shipped skills; their directories and `name:` frontmatter are renamed in the prep batch. Two of them cross-reference each other by name in their bodies.
- `package.json` (`files` array) — lists the three skill directories; must track the renamed paths so they ship in the tarball.
- `eval/harness/context.ts` + `eval/harness/context.test.ts` — the eval harness resolves skill content by name/path; renaming skills without updating this breaks the deterministic eval lane.
- `eval/cases/cases.ts` (`expect: { skill: "..." }` values) + `eval/cases/cases.test.ts` (invariant labels) + `eval/skill-file.test.ts` (path/packageEntry strings) — all assert the old skill names.
- `CLAUDE.md` (Rule 18, lines 71/96/97), `CONTRIBUTING.md`, `README.md` (skills section), `.claude/agents/execution-agent.md`, `docs/handoff.md` (current-state layout), `docs/internals/README.md` — prose references to skill names.

### Red flags

- (none — no oversized files or duplicated logic in the target area)
- **Test hotspots:** none of the touched test files are near threshold. `eval/skill-file.test.ts` is a small path-assertion table; updating its strings is mechanical.
- **Layer-fit:**
  - AC1 (rename) — not a pure-logic AC; verified by `pnpm check` (build + deterministic eval invariant tests) passing with the new names, plus `eval/skill-file.test.ts` asserting the new paths.
  - AC2/AC3/AC4 (installer) — the copy/diff behaviour is a **pure function over the `FileSystem` port**; unit-test with `InMemoryFileSystem` (clean destination, identical, diverged, `--force`). Add **one** integration smoke test that `weaver skills install --dir <tempdir>` resolves the real package skill dir via `import.meta.url` and writes the skills under the temp dir. Do not mirror exhaustive integration setup for the per-state logic.

## Value / Effort

- **Value:** The skills a user gets always match the binary they installed — the version-skew footgun of the GitHub-`main` clone disappears. Drops the external `vercel-labs/skills` dependency from the install story. Namespacing the skills (`weaver-*`) prevents collisions with other tools' skills in a shared `.claude/skills/` and gives the installer clear ownership of its files, which is what makes safe overwrite-on-update possible. `--dir` keeps the command from being hardcoded to Claude Code's location.
- **Effort:** Small-to-medium. New CLI subcommand + a small copy/diff function behind the `FileSystem` port. The namespacing prep is a wide but entirely mechanical rename across ~15 live files (skill dirs + frontmatter + reference strings), found via `weaver search-text`. No new infrastructure.

## Behaviour

- [ ] **(Prep — namespacing)** The three shipped skills are renamed from `refactor` / `code-inspection` / `search-and-replace` to `weaver-refactor` / `weaver-code-inspection` / `weaver-search-and-replace` — both the directory name and the `name:` frontmatter field. Every **live** in-repo reference is updated to the new name (the files listed under Relevant files), including the cross-references between skill bodies and the `expect: { skill: ... }` values in `eval/cases/cases.ts`. Files under `docs/specs/archive/` are **not** modified — they are frozen historical records. After this batch, `pnpm check` passes (build + deterministic eval invariant tests reflect the new names).
  - *Layer-fit:* verified by `pnpm check` and the updated `eval/skill-file.test.ts` path assertions, not by a new unit test.

- [ ] **(Install — clean destination)** Given a project whose destination directory does not yet contain weaver's skills, `weaver skills install` copies every shipped skill from the installed package's `.claude/skills/` to `<dir>/<name>/SKILL.md` (where `<dir>` defaults to `<cwd>/.claude/skills`), creating directories as needed, and prints one summary line per skill reporting it was installed and the path written. Example: `installed weaver-refactor → .claude/skills/weaver-refactor/SKILL.md`.
  - *Laziest wrong impl this rejects:* copying only the first skill, or writing to a flat file rather than `<name>/SKILL.md`. The AC requires all shipped skills and the nested layout.

- [ ] **(Install — already up-to-date)** Given a destination skill whose `SKILL.md` content is byte-identical to the shipped version, `weaver skills install` does not rewrite the file and reports it as up-to-date (e.g. `up-to-date weaver-refactor`). Running the command twice in a row with no other changes writes nothing on the second run.
  - *Laziest wrong impl this rejects:* unconditionally overwriting (would report "installed" every time and defeats idempotent reporting).

- [ ] **(Install — diverged content, with/without `--force`)** Given a destination skill whose `SKILL.md` exists but differs from the shipped version: without `--force`, `weaver skills install` leaves the file unchanged and prints a warning that it diverged and `--force` would overwrite it (e.g. `skipped weaver-refactor (diverged; use --force to overwrite)`); with `--force`, the file is overwritten with the shipped content and reported as overwritten.
  - *Laziest wrong impl this rejects:* treating "exists" the same as "identical" (would silently skip a diverged file with no warning), or overwriting diverged files without `--force` (would clobber a user's edits unasked).

> **Type matrix:** the installer's three per-skill states (absent / identical / diverged) × two modes (`--force` off/on) are the distinct code paths. The diverged×force and diverged×no-force cases differ in outcome and are covered by the AC above. All skills are `.md` text files — no `.ts`/`.vue` engine-path split applies here.

## Interface

**Command:** `weaver skills install [--dir <path>] [--force]`

- A `skills` parent command with an `install` subcommand (namespaced so future `skills list` / `skills update` fit). Registered in `src/adapters/cli/cli.ts` alongside `daemon`/`stop`.
- `--force` (boolean, default off): overwrite destination skills that have diverged from the shipped version. Absent → diverged skills are skipped with a warning.
- `--dir <path>` (string, default `<cwd>/.claude/skills`): the destination skills directory. Skills are written as `<dir>/<name>/SKILL.md`. The default targets Claude Code's discovery path; pointing `--dir` elsewhere (e.g. another host's skills directory) avoids hardcoding the command to one host's *location*. Note this does not adapt the skill *format* — see the future-work note below.

**Source resolution:** the installed package's `.claude/skills/` directory, resolved relative to the compiled CLI module via `import.meta.url`. From `<pkg>/dist/adapters/cli/cli.js` the path is `../../../.claude/skills`; this same relative depth also resolves correctly in dev (`tsx src/adapters/cli/cli.ts` → `../../../.claude/skills`), so no environment branch is needed. Realistic value: `/path/to/node_modules/@yearofthedan/weaver/.claude/skills`.

**Destination:** `<dir>/<skill-name>/SKILL.md`, where `<dir>` is the `--dir` value or its default `<cwd>/.claude/skills`. Realistic values: `./.claude/skills/weaver-refactor/SKILL.md` (default), or `<dir>` pointed at another host's skills directory.

**Core function (testable seam):** `installSkills(sourceDir, destDir, fs: FileSystem, { force }): InstallReport`, where `InstallReport` is a per-skill list of `{ name, outcome: "installed" | "up-to-date" | "skipped-diverged" | "overwritten" }`. The CLI command resolves `sourceDir`/`destDir`, calls this, and renders the report as human-readable lines.

- **Contains:** `name` is the namespaced skill directory name (`weaver-refactor`); `outcome` is the enum above. Bounds: exactly the number of shipped skills (3 today, small). Zero/empty case: if the source dir somehow contains no skills, the report is empty and the command prints nothing actionable (should not crash). Adversarial case: a destination path occupied by a non-directory, or an unreadable skill file — surfaced as an error, not a silent skip.

**Output format:** human-readable summary lines (like `daemon`/`stop`), not the operation JSON envelope. This is a setup/lifecycle command, not a refactoring operation.

## Open decisions

(none — command name, semantics, output format, namespace form, and the `--dir` location override were resolved during design and are recorded above. Per-host *format* adaptation is explicitly out of scope — see Edges.)

## Security

- **Workspace boundary:** The destination comes from `--dir` (default `<cwd>/.claude/skills`) joined with the trusted, hard-coded skill names. `--dir` is a user-supplied path, but this is an explicit one-shot setup command a person runs with intent (semantics closer to `cp` than to a daemon serving untrusted refactor requests) — writing where the user points is the expected behaviour, not a boundary to enforce. The daemon's `WorkspaceScope`/`isWithinWorkspace` machinery is deliberately not wired into this standalone CLI command. The source is weaver's own packaged files.
- **Sensitive file exposure:** N/A — the command reads only weaver's own skill markdown from its package; it never reads consumer source or config.
- **Input injection:** N/A — the only parameter is the boolean `--force`. No string reaches the filesystem or shell.
- **Response leakage:** N/A — output is skill names and fixed destination paths only.

## Edges

- **Archived specs are frozen.** The prep rename must exclude `docs/specs/archive/*`; those reference old skill names as historical record and must not change.
- **Eval harness consistency.** `eval/harness/context.ts` resolves skill content by name/path. The rename must keep the harness, the skill directories, and the deterministic eval invariant tests mutually consistent — `pnpm check` is the guard.
- **`pnpm eval` baseline shifts.** After renaming, the LLM eval lane shows the model `weaver-*` skill names instead of the old ones, so its pass-rate baseline moves. This is **not** part of `pnpm check` and does not block the slice; re-running `pnpm eval` to re-baseline is a documented follow-up.
- **Idempotency.** Two consecutive `weaver skills install` runs with no intervening edits must write nothing on the second run (all skills report up-to-date) — agents retry mechanically.
- **`search-text` brace globs.** `globToRegex` does not support brace expansion (`{md,json,ts}`) and silently returns zero matches. The implementer enumerating references must run `weaver search-text` per skill name (or per single-extension glob), not a brace glob. (Tracked as discovered tech debt in handoff.)
- **`--dir` solves location, not format (out of scope).** `--dir` lets the command write into a non-Claude host's skills directory, but it copies the SKILL.md verbatim. Hosts with a different rule format (Cursor `.mdc`, Windsurf, etc.) would not consume it correctly. Per-host format adaptation (e.g. a `--host` preset that rewrites frontmatter/layout) is a separate, larger piece of work — recorded as future work in handoff, not built here.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for the new installer source file
- [ ] `pnpm check` passes (lint + build + test, including deterministic eval invariant tests under the new skill names)
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
- [ ] Docs updated:
      - README.md skills section: **lead with `weaver skills install`**, remove the `npx skills add yearofthedan/weaver` (vercel-labs/skills) line, keep the manual `node_modules/...` reference as fallback (paths updated to `weaver-*`)
      - New command page `docs/commands/skills-install.md` (when, synopsis, output states, examples, limits) + entry in `docs/commands/README.md`
      - `docs/handoff.md` current-state layout: skill directory names updated to `weaver-*`
      - CLAUDE.md Rule 18 + `.claude/agents/execution-agent.md` + `CONTRIBUTING.md` + `docs/internals/README.md`: skill-name references updated to `weaver-*`
- [ ] Tech debt / future work added to handoff.md: (a) `search-text` brace-glob silently returns empty (`[needs design]`); (b) per-host skill *format* adaptation — a `--host` preset that rewrites SKILL.md into other hosts' rule formats (`[needs design]`)
- [ ] `pnpm eval` re-baseline noted as a follow-up (run after merge; not a `pnpm check` gate)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
</content>
</invoke>
