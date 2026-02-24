**Purpose:** Explain why light-bridge exists — the problem, the value, and how it fits into the AI coding ecosystem.
**Audience:** Developers evaluating adoption, and contributors who want to understand the thesis.
**Status:** Current
**Related docs:** [Vision](vision.md) (roadmap), [README](../README.md) (getting started)

---

# Why light-bridge

AI coding agents can read and write files. They can grep, search, and replace. But when a refactoring operation touches many files — renaming a widely-used symbol, moving a core module — agents fall back to brute-force strategies that are slow, expensive, and fragile.

IDEs solved this problem years ago. When you press F2 to rename a symbol in VS Code, the TypeScript language service finds every reference through the compiler's own analysis and updates them all atomically. It takes milliseconds.

light-bridge makes that same compiler intelligence available to AI agents through a standard tool interface (MCP). The agent says *what* it wants — "rename `calculateSum` to `calculateTotal`" — and light-bridge handles *how*, using the same engines that power IDE refactoring.

The value comes down to three things.

## Speed

light-bridge runs a daemon that stays alive between agent sessions. The daemon loads the project graph on demand and keeps the Node.js process warm — there is no spawn or bootstrap cost after the first request. For file edits detected by the filesystem watcher, only the affected source file is refreshed. Structural changes (files added or removed) trigger a full lazy rebuild on the next request, but even then the daemon is already running and the rebuild is faster than a cold start from scratch.

The agent-facing cost is one tool call and one response — no matter how many files are affected.

Without light-bridge, the agent has to:

1. Find every file that might reference the symbol (search/grep)
2. Read each file into context
3. Determine which matches are real references vs. coincidental string matches
4. Edit each file
5. Verify no references were missed

With light-bridge, the agent issues a single `rename` call. The compiler walks its reference graph, applies the changes, and returns a summary.

## Determinism

Search-and-replace is probabilistic. A symbol named `id` appears in dozens of contexts — local variables, object properties, unrelated identifiers. An agent doing textual replacement has to reason about scope, shadowing, and re-exports for every match. It will sometimes get it wrong.

Compiler-driven refactoring is deterministic. The TypeScript compiler (and Volar, for Vue) knows the exact binding graph. It distinguishes between `user.id` and a local `const id` in an unrelated function. It follows re-exports through barrel files. It handles aliased imports. The result is correct by construction, not by probability.

This matters most for the operations agents struggle with:

- **Rename** across file boundaries, especially through re-exports
- **Move file** with complex import graphs (relative paths, index files, path aliases)
- **Move symbol** between files, rewriting importers that had no direct relationship to the destination

The cost of getting it wrong is not just one missed reference — it is a retry loop. The agent renames a symbol, misses a reference, the build breaks. It reads the compiler error, tries to patch the missed file, potentially introduces another inconsistency. Each retry burns another turn of context and reasoning. Deterministic operations eliminate this failure mode entirely: the operation either succeeds completely or fails with a clear error before any files are modified.

## Context efficiency

Every file an agent reads consumes context window capacity and incurs token cost. Cross-file refactoring is the worst case: the agent needs to load potentially dozens of files for what is ultimately a mechanical transformation.

More context is not just more expensive — it is less reliable. As the context window fills with mechanical detail (file contents, import paths, diff hunks), the agent is more likely to hallucinate: misremembering which file had which import, confusing two similarly-named symbols, or generating an edit that is subtly wrong. A hallucinated edit produces a new error, which the agent reads, which adds more context, which increases the chance of the next hallucination. The failure mode is a vicious loop of context accumulation and compounding mistakes.

light-bridge breaks that loop by keeping mechanical work out of the context window entirely. The agent sends an intent; it gets back a JSON summary listing which files changed. It never sees the raw diffs. The context window stays available for the work that actually requires intelligence — understanding requirements, designing interfaces, writing new logic.

For a rename that touches 20 files, the difference is stark:

- **Without light-bridge:** ~20 file reads + ~20 file writes + reasoning about each one. Thousands of tokens spent on mechanical edits.
- **With light-bridge:** one tool call, one response. A few hundred tokens total.

The cost saving compounds over a session, and scales non-linearly with project size. In a 10-file project, an agent can brute-force a rename and the overhead is tolerable. In a codebase with hundreds of files, the same rename might touch dozens of modules across multiple layers — the token cost of loading all of them becomes prohibitive.

This creates a secondary problem: **refactoring avoidance**. When refactoring is expensive, agents stop doing it. They tolerate a misleading name, a file in the wrong directory, or a function that belongs in a different module — because the cost of fixing it exceeds the immediate benefit. The codebase accumulates structural debt faster than it should.

Cheap refactoring changes the agent's behaviour, not just its speed. An agent with access to reliable, low-cost rename and move will restructure code as it works — renaming for clarity after understanding a module, moving code into better locations as patterns emerge. Without these tools, the agent tends to only add code; it rarely improves structure.

## Where it fits: the AI coding ecosystem

light-bridge is infrastructure, not an agent. It provides compiler-driven refactoring as a service to any agent that speaks MCP (Model Context Protocol). The integration pattern depends on where the agent runs.

### Local agents

Agents running on the developer's machine — Claude Code, Cursor, Roo, Windsurf, and others — connect to light-bridge over stdio. The typical setup:

- The developer installs light-bridge in the project (or globally)
- The agent host is configured to launch `light-bridge serve` for the workspace
- The daemon auto-spawns on first tool call and stays running between sessions
- Each agent session gets its own `serve` process; they share the warm daemon

This is the simplest integration. The daemon lives alongside the editor and agent, watching the same filesystem. There is no network boundary.

### Devcontainers

light-bridge runs in devcontainers out of the box — it is developed in one. Install it as a project dependency, configure the MCP server in your devcontainer setup, and the daemon runs inside the container alongside the agent and the code. No host-side tooling required.

This is particularly relevant for teams standardising on devcontainers for reproducible development environments. The refactoring tooling travels with the container definition, not with each developer's local machine.

### Remote and containerised agents

Agents running in cloud environments — Codex, Devin-style autonomous agents, CI/CD pipelines with AI-assisted refactoring — install light-bridge in the same container or VM where the code lives.

The architecture is identical: daemon + serve, communicating over a local Unix socket. The difference is operational — the daemon's lifetime is tied to the container rather than a developer's workstation. In ephemeral environments, the daemon starts fresh each run; in persistent workspaces, it stays warm across sessions just like the local case.

Since MCP is the interface, the remote agent's integration code is the same as a local agent's. No adapter layer is needed.

### Why MCP and not a CLI

light-bridge is an MCP server, not a command-line refactoring tool. This is a deliberate choice, but it does not rule out a CLI in the future.

**Why MCP first:** The daemon architecture exists because loading a TypeScript project graph is expensive — it can take seconds for a large codebase. A CLI tool that boots, parses the project, performs one rename, and exits would pay that startup cost on every invocation. The daemon pays it once. MCP is the natural interface for a long-lived process that serves multiple requests: the agent host manages the connection lifecycle, and the daemon stays warm.

MCP also gives agents structured input and output. A CLI tool returns text; the agent has to parse it. An MCP tool returns typed JSON — the agent gets `filesModified` as an array, not a string it has to interpret.

**Where a CLI could help:** Not every operation needs a language server. A text-based search-and-replace or a file move by path could run without loading a project graph at all. And even for compiler-driven operations like rename, some users would accept a cold-start delay if it means no daemon to manage — a single command that boots, refactors, and exits. A CLI is a plausible future addition — the engine layers are already separated from the MCP transport, and a CLI subcommand could either connect to a running daemon or load the project directly depending on what's available.

## What already exists

The idea of giving agents access to compiler-driven refactoring is not new. Some tools already offer parts of this:

- **JetBrains IDEs** expose their refactoring engine via an MCP integration, letting agents call IntelliJ's rename, move, and other operations.
- **Cursor** ships built-in tools (like its codebase search) that go beyond raw file reads, giving the agent structured access to project knowledge.
- **VS Code extensions** and language servers provide refactoring capabilities that could, in principle, be wired to agents.

light-bridge exists because these options share common constraints:

- **License-tied.** Most are bundled with commercial IDEs. The refactoring intelligence is available only if the user has a licence for that specific tool.
- **Not headless.** They typically require a running GUI application. You can't install IntelliJ in a CI container or a headless cloud VM just to get rename-symbol. Agents running in remote or containerised environments — Codex, Devin-style systems, CI pipelines — need tooling that runs without a desktop.
- **Scope-limited.** Where integrations do exist, they tend to expose a narrow slice of what the IDE can do, not a purpose-built interface designed for how agents actually work (structured intents in, semantic summaries out).

light-bridge is open-source, headless, and designed from the ground up as agent infrastructure. It runs anywhere Node.js runs — a developer's laptop, a devcontainer, a cloud VM — with no IDE dependency and no licence requirement.

## Who benefits

- **Agent developers** building coding assistants who want reliable refactoring without implementing compiler integration themselves
- **Teams using AI agents** for day-to-day development who want refactoring operations to be fast and correct rather than token-expensive and approximate
- **Contributors** interested in the intersection of compiler tooling and AI agent infrastructure

