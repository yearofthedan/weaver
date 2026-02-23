# Documentation Index

**Purpose:** Navigate the light-bridge documentation by your role and needs.

## Quick Start

- **I want to use light-bridge** → Start with [README](../README.md), then integrate with [CLAUDE.md](../CLAUDE.md)
- **I'm implementing a feature** → Start with [Vision](vision.md), then [Handoff](handoff.md)
- **I'm reviewing security** → Start with [Security](security.md), then check specific [Features](features/)
- **I'm debugging an issue** → Start with [Tech Debt](tech/tech-debt.md), then [Agent Memory](agent-memory.md)

## By Document

### Product & Vision
- [Vision](vision.md) — What light-bridge does, who it's for, and what's next

### User Integration
- [CLAUDE.md](../CLAUDE.md) — How to configure your agent to use light-bridge
- [Features Overview](features/README.md) — All operations: rename, moveFile, moveSymbol, findReferences, getDefinition

### For Developers
- [Handoff](handoff.md) — Current state, source layout, next work items
- [Security](security.md) — Threat model, controls, known limitations
- [Quality](quality.md) — Testing expectations, performance targets, reliability guarantees

### Architecture & Implementation
- [Features](features/) — Per-operation guides (how to use, how it works, constraints, security)
  - [rename](features/rename.md)
  - [moveFile](features/moveFile.md)
  - [moveSymbol](features/moveSymbol.md)
  - [findReferences](features/findReferences.md)
  - [getDefinition](features/getDefinition.md)

### Technical Reference
- [Agent Memory](agent-memory.md) — Implementation gotchas, hard-won lessons, architectural decisions
- [Tech Debt](tech/tech-debt.md) — Known structural issues and their fixes
- [Volar v3 Architecture](tech/volar-v3.md) — How the Vue engine works (required reading before touching Vue code)

### Project Notes
- [MEMORY](../.claude/MEMORY.md) — Session-to-session state signpost
