**Purpose:** Explain why weaver exists — the problem, the value, and how it fits into the AI coding ecosystem.
**Audience:** Developers evaluating adoption, and contributors who want to understand the thesis.
**Status:** Current
**Related docs:** [Handoff](handoff.md) (current state + roadmap), [README](../README.md) (getting started)

---

# Why weaver

AI coding agents are inherently probabilistic, but refactoring is a deterministic problem. Variable renames, method extractions, and other common refactors all require precision. 

When an AI agent attempts to restructure a project the approach is unpredictable, generally one involving multiple `grep` -> `review` -> `edit` loops, or `modify` -> `build` -> `fix` loops. These cycles waste time and flood the context window with unnecessary noise, and in many cases lead AI agents to avoid refactors due to the fear of large scale changes.

Humans already solved these problems with IDE tools that leverage language servers. Weaver aims to give AI agents those same tools.

## Speed and determinism
In the agentic era, latency is a bottleneck. Raw searches take cycles to run and review. 

Weaver runs a daemon that stays alive between agent sessions. It loads the project graph on demand, and then watches for file changes and updates in the background. Queries are always against the latest state of the project.

Refactors in Weaver are a single call, the compiler walks its reference graph, applies the changes, and returns a summary. Agents are told what has been updated, and don't need to spend more cycles and time verifying, or updating additional files. 

Without this sort of tooling, an agent has to:

1. Find every file that might reference the symbol (search/grep)
2. Read each file into context
3. Determine which matches are real references vs. coincidental string matches
4. Edit each file
5. Verify no references were missed

The cost of getting it wrong is a retry loop. The agent renames a symbol, misses a reference, the build breaks. It reads the compiler error, tries to patch the missed file, potentially introduces another inconsistency.  Deterministic operations eliminate this failure mode entirely: the operation either succeeds completely or fails with a clear error before any files are modified.

## Context efficiency
Reading raw code just to perform mechanical edits is a waste of tokens. Every file an agent reads to "understand" a simple rename consumes context window capacity and makes the agent less reliable. As the context window fills with mechanical detail (file contents, import paths, diff hunks), the agent is more likely to hallucinate as it performs other tasks.

Weaver keeps mechanical work out of the context window entirely. The agent sends an intent; it gets back a JSON summary listing which files changed. It never sees the raw diffs. The context window stays available for the work that actually requires intelligence — understanding requirements, designing interfaces, writing new logic.

## Better practices
When refactoring is expensive, agents stop doing it. They tolerate a misleading name, a file in the wrong directory, or a function that belongs in a different module — because the cost of fixing it exceeds the immediate benefit. The codebase accumulates structural debt faster than it should.

Weaver works on the hypothesis that cheap refactoring tools along with well framed refactoring instructions, change the agent's behaviour, not just its speed producing better quality code.

## Headless by design
Most existing refactoring engines are license-tied or require a running GUI application. You cannot easily install a full IDE in a CI container, a devcontainer, or a headless cloud VM.

Weaver is agent infrastructure.

- Harness Empowerment: Weaver brings compiler intelligence to any environment. If the agent has a shell, it has Weaver.
- CLI-First: While it supports MCP (Model Context Protocol) for easy integration with tools like Claude Code or Cursor, it is a CLI tool at its core. It treats the command line as the primary interface for agentic automation.

## What's worth building

Each potential operation is evaluated against one bar "what are the boring, repeatable, error prone jobs that get in the way of agent creativity?". Language server backed operations are the natural fit here, but Weaver's potential extends to any repeatable deterministic task. 

