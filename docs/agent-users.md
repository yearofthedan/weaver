**Purpose:** Characteristics of AI coding agents that should inform every design decision in light-bridge.
**Audience:** Anyone designing or speccing a feature. Read this before writing a spec.
**Status:** Current
**Related docs:** [Why](why.md) (product rationale), [MCP transport](features/mcp-transport.md) (tool interface)

---

# Designing for agent users

light-bridge's primary users are AI coding agents — LLMs operating inside tool-use loops. They are not humans with a terminal. The differences matter for every interface decision: parameter design, defaults, response shapes, error messages, and what information to include or omit.

## The core principle: prefer guardrails over assumptions

Agents are poor at optimising and planning their own workflows. They won't anticipate that they'll need type errors after a rename, discover an opt-in flag and decide to use it, or batch related calls for efficiency. If the right workflow requires foresight, agents won't do it.

**Build the foresight into the tool.** The tool should do the right thing by default — return the useful information, enforce the safe boundary, choose the sensible mode. Let agents opt *out* when they have a specific reason, but never require them to opt *in* to the obviously correct behaviour.

This principle shows up in every section below. Each characteristic is a specific way agents lack foresight, and each design rule is a guardrail that compensates.

## How agents differ from humans

### They read the tool description, nothing else

An agent discovers light-bridge through MCP tool descriptions. It will never browse a README, search a docs site, or read a changelog. If a capability isn't surfaced in the tool description the agent sees at call time, it doesn't exist. Opt-in flags that require the agent to know about a feature before using it are effectively invisible.

### They won't plan the optimal sequence of calls

A human might think "I'll rename this symbol, then check for type errors to make sure nothing broke." An agent operates one tool call at a time — it won't anticipate what information it will need after a mutation completes. If type errors after a rename are useful (they are), return them automatically. Don't expect the agent to plan a two-step workflow when the tool can just do it.

**Design rule:** if you're adding a boolean flag, ask "would a competent human always turn this on?" If yes, it shouldn't be a flag — it should be the default behaviour.

### They consume structured data, not prose

Agents parse JSON fields. A response like `{ filesModified: ["a.ts", "b.ts"], typeErrors: [...] }` is immediately actionable. A paragraph explaining what happened forces the agent to extract facts from natural language — slow, token-expensive, and error-prone.

Return structured data. Use prose only in `description` fields that help the agent understand *what a tool does*, not in response payloads that tell it *what happened*.

### They are literal interpreters

Vague descriptions produce wrong usage. "The file path" doesn't tell the agent whether it wants absolute or relative, workspace-relative or cwd-relative. "Absolute path to the file within the workspace" does. Every parameter description should be specific enough that there's one obvious way to provide the value.

### They have bounded context

Every token in a response competes with the agent's reasoning capacity. Over-large responses — full file contents, verbose diffs, hundreds of type errors — push useful context out of the window and increase hallucination risk.

Return summaries by default. Cap unbounded lists. Never return raw file contents when a structured summary would do.

### They can't do interactive flows

No confirmations, no multi-step wizards, no "did you mean X?" prompts. Every tool call must be a complete intent that produces a complete result. If an operation needs disambiguation, fail with a structured error that tells the agent exactly what to provide differently — don't ask it a question.

### They retry mechanically on failure

When a tool call fails, agents typically retry with slight variations. This means:
- **Idempotency matters.** A rename that already happened should not fail on retry — or if it does, the error should make clear "this was already done" rather than "symbol not found."
- **Error codes matter more than error messages.** Agents branch on structured error codes, not on parsing English sentences. Every distinct failure mode needs its own code.
- **Transient vs permanent must be obvious.** `DAEMON_STARTING` is retriable; `SYMBOL_NOT_FOUND` is not. The agent shouldn't have to guess.

### They don't remember across sessions

Each agent session starts fresh. Anything the agent learned in a previous session — which tools are available, what parameters work best, which patterns to avoid — is gone. The tool interface must be self-describing every time: good tool descriptions, clear parameter docs, informative error messages. Don't design for a user who "learns" the tool over time.

## Applying this to design

When speccing a feature, run through these questions:

1. **Guardrails over assumptions:** Does any part of this design require the agent to have foresight about its own workflow? → Build that foresight into the tool instead.
2. **Defaults:** Would a competent user always want this? → Make it the default, not a flag.
3. **Response shape:** Is every field in the response immediately actionable? → If not, restructure or remove it.
4. **Response size:** Could this response blow up for a large project? → Cap it, summarise it.
5. **Parameters:** Is there exactly one obvious way to provide each value? → If not, tighten the description.
6. **Errors:** Can the agent programmatically distinguish every failure mode? → If not, add an error code.
7. **Discoverability:** Would an agent know this feature exists from the tool description alone? → If not, it won't be used.

## Writing tool descriptions

Tool descriptions are the only interface between agents and light-bridge. Every description is loaded into context on every request, so verbosity has a direct cost. These principles guide what to include and how to say it.

### Lead with when to use, not what it does

An agent deciding which tool to call needs to match its intent to a tool. "Rename a symbol at a given position" describes the mechanic — "When renaming an identifier, use this to update every reference project-wide" tells the agent when to reach for it. Start with the situation, then the mechanic.

### Say what the compiler gives you that alternatives don't

Every tool competes with "just use searchText + replaceText" or "just read the file." If the compiler provides scope-awareness, cross-file tracking through re-exports, or automatic parameter inference, say so — that's why the agent should pick this tool over a text-based alternative.

### Surface constraints that prevent failed calls

If a parameter has a non-obvious format requirement (endCol is inclusive, selection must cover complete statements, only top-level exports are supported), put it in the description. A failed call wastes a round-trip and context tokens. A constraint in the description prevents it.

### Describe what the agent gets back

Agents need to know what fields to expect so they can act on the response. For mutating tools, mention filesModified, filesSkipped, and typeErrors. For read-only tools, mention the result shape (references array, definitions array). Don't enumerate every field — focus on the ones the agent needs to branch on.

### Keep shared conventions in server instructions

Information that applies to all tools — DAEMON_STARTING retry behaviour, workspace boundary enforcement, project graph caching — belongs in the server `instructions` field, not repeated in each description. Per-tool descriptions should only contain what's unique to that tool.
