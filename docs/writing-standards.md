**Purpose:** How the agent writes anything that outlives the conversation — commits, comments, docs, specs.
**Audience:** Agents and engineers writing durable records in this repo.
**Status:** Current

---

# Writing standards

**State the point directly — no narrative, no hype, no build-up.** Applies to everything you write: docs, commit messages, and replies to the user. Cut the walk-up paragraph, the "not just A, but B" construction, dramatic framing ("the interesting bit is…"), and hype ("this is the real deal"). Prefer a table, list, or bare fact over a paragraph that leads up to one. In living docs that means no changelog narration ("moved from P2", "former X", "now reframed"): when you *complete* something a living doc lists as a gap, recommendation, or to-do, **delete the entry** rather than annotating it "(done)" / "(filled)" / "(fixed)" — a struck-through or checkmarked recommendation is narration too. Before editing any entry, ask whether it should still *exist*, not just how to reword it.

**Living docs and dated records have opposite rules.** A living doc (`docs/`, `CLAUDE.md`, skills) must hold what is true now — a reference to something that no longer exists is a bug to fix. A dated record (`CHANGELOG.md`, `docs/specs/archive/`) holds what was true when written — the same stale reference is *correct* there, and editing it falsifies the record. A repo-wide purge of a removed concept therefore excludes the archive (`excludeGlob: '{docs/specs/archive/**,CHANGELOG.md}'`) or it rewrites history.

**A date stamps a value that decays, never an event.** A cost, rate, or version needs one — undated, the reader can't judge staleness. When something broke or when you learned it does not; that date is narration.

**Two tests before writing anything durable.** A commit body, a code comment, a doc paragraph, a spec section, a description, a PR body — anything that outlives the conversation gets both:

- **Recency (motive):** would this be here if the conversation had gone differently? Whatever you just worked on or just explained feels like context to you and reads as noise to someone who wasn't there. If the answer is no, it's salience, not relevance — cut it.
- **Ownership (placement):** is this already captured somewhere, and does capturing it *here* durably serve the reader? If another artifact owns it, link it — don't copy it, and don't let a wrapper restate what the thing it wraps already records. Passing the recency test does not excuse failing this one. An "already covered" verdict is a claim about two texts: read the candidate owner before making it.

**Evidence goes in the dated record, the rule in its owning doc.** The run or incident behind a rule belongs in a baselines entry or an archived spec's Outcome — the ownership test applied to evidence.

**Banned phrases.** These read as filler and must not appear in docs, commit messages, code comments, or replies: *earns its place* / *earned its place*, *load-bearing*, *muddies*. Two sentence shapes go with them: the affirm-then-justify opener ("good question, and it matters", "yes, and it's worth X, because Y") and the editorialising lead-in ("honestly…", "the honest read is…"). State the fact without validating the question or telegraphing that an answer is coming.
