# Distribution: Stage 1 — npm publish + install docs

**type:** change
**date:** 2026-03-03
**tracks:** handoff.md # Stage 1: npm publish + install docs → README.md, docs/why.md, CONTRIBUTING.md

---

## Context

The tool is feature-complete enough to distribute. The package is already configured for npm (`publishConfig: { access: public }`, `prepublishOnly` script). What's missing: `--workspace` requires an explicit path (friction for project-level configs), Cursor has no config snippet, the README is mixed user/contributor content, and there's no "when NOT to use this" to help evaluators self-select.

## Value / Effort

- **Value:** Removes the last friction points before a first external user can install and configure the tool. Without a workspace default, every MCP config needs a hardcoded absolute path — that breaks portability across machines, devcontainers, and cloud runners. Without the Cursor snippet, Cursor users have to guess. Without a comparison section, evaluators read the whole doc trying to figure out if this is the right tool.
- **Effort:** Small. Three CLI option declarations change from `requiredOption` to `option`. README additions are prose + one code block. No new operations, no test fixture changes.

## Behaviour

- [ ] Given `light-bridge serve` with no `--workspace` flag, the command uses `process.cwd()` as the workspace root — same behaviour as if `--workspace .` had been passed from the project directory. Applies equally to `daemon` and `stop`.
- [ ] Given `light-bridge serve --workspace /explicit/path`, the explicit path is used as before — the default does not shadow an explicit argument.
- [ ] The README Agent integration section includes a Cursor config snippet using `${workspaceFolder}` for the workspace argument.
- [ ] The README contains a "When NOT to use this" section comparing light-bridge against: base agent tools (grep/file read-write), Claude's built-in Language Server (`typescript-lsp` plugin), and IntelliJ MCP — with honest call-outs of when each alternative is the better fit.
- [ ] The README Development section (setup, build, test, project structure) is extracted to `CONTRIBUTING.md`; the README links to it with a single line.

## Interface

**CLI change — `--workspace` becomes optional:**

All three subcommands (`daemon`, `serve`, `stop`) change from `requiredOption` to `option` with a default:

```ts
.option("--workspace <path>", "Root directory of the project to serve", process.cwd())
```

Realistic values: `/home/user/project`, `.`, `${workspaceFolder}` (resolved by the agent host before passing to the process). Empty string is not a valid path — Commander will pass the default if the flag is absent; the existing workspace validation in the dispatcher catches an empty or invalid path at runtime.

Zero case: flag absent → `process.cwd()`. This is the expected case for project-local configs where the agent host sets cwd to the workspace root before spawning.

Adversarial case: cwd is `/` or some unrelated directory (e.g. agent host sets a wrong cwd). Result: the daemon loads the wrong project. This is the same failure mode as passing a wrong explicit path — not new, and the existing workspace boundary enforcement already handles it.

**Cursor MCP config snippet:**

```json
{
  "mcpServers": {
    "light-bridge": {
      "command": "light-bridge",
      "args": ["serve", "--workspace", "${workspaceFolder}"]
    }
  }
}
```

Goes in `.cursor/mcp.json` or the Cursor global MCP settings. `${workspaceFolder}` is resolved by Cursor to the open workspace root. (Once `--workspace` defaults to cwd, this can be simplified further — but `${workspaceFolder}` is explicit and portable, so keep it for clarity.)

**Comparison section — target structure:**

Three comparisons, each answering: "use that instead when…"

| Alternative | Use instead when… | light-bridge wins when… |
|---|---|---|
| Base agent tools (grep, read/write) | The change is in one file, or the agent's context window can hold everything comfortably | The change fans out across many files; missing one breaks the build |
| Claude's built-in `typescript-lsp` | You only need diagnostics and navigation (jump to def, find refs) | You need to *apply* structural changes (rename, move, extract) — the two stack, not compete |
| IntelliJ MCP | You're already running IntelliJ and want the full IDE refactoring suite | You're in a devcontainer, CI, or remote environment where a GUI IDE isn't available |

## Edges

- Existing `--workspace` usage (explicit path) is fully backward-compatible — the change only makes the flag optional.
- The repo's own `.mcp.json` already uses `"."` as the workspace argument. It continues to work as-is and need not be changed.
- `pnpm agent:check` enforces that committed MCP configs don't contain hardcoded absolute paths — this constraint is unchanged.
- The `why.md` section "What already exists" already mentions JetBrains/IntelliJ and Cursor. The new comparison section in README should be consistent with that framing, not contradict it. Cross-link rather than duplicate.

## Done-when

- [ ] All ACs verified by tests (CLI default: at minimum one test asserting `serve`/`daemon`/`stop` accept no `--workspace` flag without error)
- [ ] `pnpm check` passes (lint + build + test)
- [ ] README updated: Cursor snippet added, comparison section added, Development section removed and linked to CONTRIBUTING.md
- [ ] CONTRIBUTING.md created with the extracted Development content
- [ ] `docs/why.md` cross-linked from the comparison section (no duplication)
- [ ] Package published to npm (`pnpm publish` or `npm publish`)
- [ ] handoff.md Stage 1 entry removed
- [ ] Agent insights captured in docs/agent-memory.md
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
