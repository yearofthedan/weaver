**Purpose:** How the agent talks to the user, and how it writes anything that outlives the conversation — commits, comments, docs, specs.
**Audience:** Agents working in this repo, and engineers writing durable records.
**Related docs:** [Code standards](code-standards.md) (how code is written), [Design principles](design-principles.md) (the shape of a change)
**Status:** Current


# Communication standards

**State the point directly — no narrative, no hype.** Applies to everything you write: docs, commit messages, and replies to the user. You aren't here to build relationships; you are here to help users quickly understand and make decisions. So state facts without validating the user's question or telegraphing that an answer is coming. Cut:

- walk-up paragraphs and dramatic framing ("the interesting bit is…")
- the "not just A, but B" construction
- affirm-then-justify openers ("good question, and it matters", "yes, and it's worth X, because Y")
- editorialising lead-ins ("honestly…", "the honest read is…")
- the phrases "earns its place" and "load-bearing"

When communicating with the user, protect their cognitive load. Prefer a table, a concise list, or bare fact over a paragraph that leads up to one.

**Concise is not clipped.** Cutting filler means removing padding, not compressing into fragments. Write normal, clear prose with the fluff gone — brief complete sentences, not shorthand or note form. Overshooting into terseness costs the reader a round trip the same way padding does.

**Don't describe negative space.** Naming what something doesn't contain tells the reader nothing — "does not use X" in a commit body is meaningless to anyone reading the log later without the conversation. A positive claim fails the same way once you enumerate the absences: "dependency-free" stands on its own; "dependency-free — no lodash, no date-fns" is a list of what isn't there.

**Never hide assumptions.** In conversation with the user you must always be clear about knowledge gaps, and where you made assumptions. Never state assumptions as facts. When working autonomously, assumptions must be surfaced to the user through relevant documentation, or reports, as early as possible.

**Living docs and dated records have opposite rules.** Living docs — documentation, agent instructions, skills — must hold what is true now; dated records — changelogs, archived specs — hold what was true when written. Rules belong in living docs, the incident behind the rules does not; that belongs in changelogs or archived spec outcomes. Tasks in living docs should be **removed**, not annotated, when completed. Repo-wide changes, like find/replace text, should usually exclude dated records to avoid rewriting history.

**Check for relevance and placement before writing anything durable.** A commit body, a code comment, a doc paragraph, a spec section, a description, a PR body — anything that outlives the conversation gets both:

- **Relevance:** is this information important to the work, or important to the conversation you just had? Sometimes when you clarify a point it can feel like important context, but on reflection is noise to someone who wasn't there. Assess for relevance, and if it isn't, cut it.
- **Placement:** is this already captured somewhere, and does capturing it *here* durably serve the reader? If another artifact owns it, link it — don't copy it, and don't let a wrapper restate what the thing it wraps already records. Just because something is relevant, doesn't always mean it's in the right place. Ensure the information is stored in the right place, and if that place isn't here, cut it.
