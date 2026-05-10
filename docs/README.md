# Documentation Index

**Purpose:** Navigate the weaver documentation by your role and needs.

## Quick Start

- **I want to use weaver** → [README](../README.md) — install, one-line example, agent integration
- **I want a command's reference page** → [Commands](commands/) — every CLI/MCP command, one page each
- **I want shared conventions** → [Reference](reference/) — response format, error codes
- **I'm implementing a feature** → [Handoff](handoff.md) — backlog, current state, finish checklist
- **I'm reviewing security** → [Security](security.md), then specific [Internals](internals/)
- **I'm debugging an issue** → [Tech Debt](tech/tech-debt.md)

## Product & Rationale

- [Why weaver](why.md) — what it is, the problem it solves, design bar, ecosystem fit
- [Agent users](agent-users.md) — design philosophy for tools that target AI agents

## User-facing reference

- [Commands](commands/) — per-command pages: when to use, inputs, outputs, errors, examples, limits
- [Reference](reference/) — `status`, response shapes, full error code list
- [README](../README.md) — install, agent integration, top-level overview

## Project management

- [Handoff](handoff.md) — current state, prioritised backlog, reading order, finish checklist
- [Quality](quality.md) — testing strategy, coverage targets, mutation scores
- [Tech Debt](tech/tech-debt.md) — known structural issues

## Architecture & implementation

- [Architecture](architecture.md) — provider/operation/dispatcher design; read before touching `src/`
- [Security](security.md) — threat model, controls, known limitations
- [Internals](internals/) — per-command implementation, technical decisions, and shared infrastructure (daemon, watcher, MCP transport)
- [Volar v3](tech/volar-v3.md) — Vue provider internals; required reading before touching `plugins/vue/engine.ts`

## Agent docs

- [MEMORY](./../.claude/MEMORY.md) — process rules and project state signpost
