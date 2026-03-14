# Documentation Index

**Purpose:** Navigate the light-bridge documentation by your role and needs.

## Quick Start

- **I want to use light-bridge** → [README](../README.md) — installation, CLI, MCP tools, agent integration
- **I'm implementing a feature** → [Handoff](handoff.md) — backlog, current state, finish checklist
- **I'm reviewing security** → [Security](security.md), then specific [Features](features/)
- **I'm debugging an issue** → [Tech Debt](tech/tech-debt.md)

## Product & Rationale

- [Why light-bridge](why.md) — what it is, the problem it solves, design bar, ecosystem fit

## Project Management

- [Handoff](handoff.md) — current state, prioritised backlog, reading order, finish checklist
- [Quality](quality.md) — testing strategy, coverage targets, mutation scores
- [Tech Debt](tech/tech-debt.md) — known structural issues

## Architecture & Implementation

- [Architecture](architecture.md) — provider/operation/dispatcher design; read before touching `src/`
- [Security](security.md) — threat model, controls, known limitations
- [Features](features/) — per-operation specs (rename, moveFile, moveSymbol, …) and infrastructure docs
- [Volar v3](tech/volar-v3.md) — Vue provider internals; required reading before touching `providers/volar.ts`

## Agent Docs

- [MEMORY](./../.claude/MEMORY.md) — process rules and project state signpost
