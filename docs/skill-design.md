**Purpose:** How to design weaver's skill files — the descriptions and bodies agents load to work with weaver.
**Audience:** Anyone writing or editing a weaver skill (`.claude/skills/weaver-*/SKILL.md`). Read before touching one.
**Status:** Current
**Related docs:** [Designing for agent users](agent-users.md) (tool interface, params, response shapes, description-field craft), [Eval design](eval-design.md) (how skill changes are tested — the pressured lanes), [Why](why.md) (product rationale)

---

# Designing weaver skills

Skills are the primary interface most agents have to weaver: an agent discovers weaver through its skill files and works mostly from the body of whichever it loads. Skills are **interface documentation, not agent playbooks** — they describe what the tool returns and what each field means, never what the agent should do in response (that is the caller's policy, which weaver has no context for). Within that constraint, a skill's job is to get the agent to actually reach for weaver, and to use it well once it does.

The principles below are what we have *observed*, not a proven playbook. Several are open. None should be applied by reasoning alone — a skill change is proven only by the pressured eval lanes ([`eval-design.md`](eval-design.md)), never by argument about what "should" work.

## A skill is adversarial *and* descriptive — displace the host's default while documenting the op

A skill must be accurate interface documentation — what the op does, its fields, its constraints (see [Designing for agent users](agent-users.md) for that craft). That is necessary but not sufficient. The host harness's system prompt installs the agent's default reflexes *before* weaver's skill is ever read, and weaver's value is zero unless the agent uses it over those defaults. Claude Code's own prompt, for one, says "prefer the dedicated file/search tools over shell commands" — inertia that can resolve to `grep` or the built-in tools rather than weaver. So a skill must *also* displace the competing default the host has already installed, op by op: `grep` → text, `grep`/`find` → importers, `tsc` → type errors, `mv` → moves, `sed` → replacements.

**What's observed — and how narrow it is.** The pressured-emission lane ([`eval-design.md`](eval-design.md)) precedes the task with a *3-turn shell-momentum seed* — three back-to-back shell calls (`grep` a log, `git log`, `find`), the pool maximum — inside a generic crowded prompt: deliberately heavy priming. Under it, at temp 0, the gate model fell back to the shell only on the most shell-shaped *subset* of ops (text/importer search → `grep`, type-check → `tsc`); most held even then. The effect is reproducible for *fixed* skill content but **conditional on that strong priming** — untested under lighter priming, none, or a real host prompt (which primes differently and carries its own pro-tool nudge). So the established fact is narrow: strong priming can pull a *subset* of ops shell-ward. It does not show the model fails at weaver in normal use. Prove any skill change on the lane, never by reasoning.

**How best to beat it: one tactic measured, and it is narrower than it looks.** The current skills lead with a decision-path router (an intent → command → **Never** table) plus an anti-momentum clause. Removing the table while holding every fact, command, and displaced shell tool constant ([table-removal spike](specs/archive/20260801-skill-router-table-removal.md)) moved a single case on the gate model: `command-get-type-errors`, **16/22 with the table against 10/21 without**, across 43 trials, direction never reversing on pooled data. Keep the router — nothing measured suggests it harms, and every pooled comparison leaned its way. Do not promote it to a proven pattern:

- The one case it moved is one **Gemini 2.5 Flash and GPT-5.6-Luna both clear 3/3 at ceiling**. The table carries the weakest model on its weakest case; the other two never needed it — removing it doesn't move either off ceiling on that case, or fix Luna's two failing boundary cases, so it has no measured effect on either model in either direction. A tactic that only shows up on the instrument is not yet a tactic for the audience.
- Across the other five cases tested, the result was mixed — one worse, one better, three unchanged. No generalisation is established.
- The holds are **brittle** — all skill bodies share one context, so an edit anywhere can tip a knife-edge case; reinforcement that looks redundant has proven load-bearing, so never trim it without re-running the full lane.
- Some reflexes **resist even an explicit `Never` row** (`tsc` on the gate model), and "wording can't hold this" is a legitimate recorded verdict.

Keep the router for its maintenance properties too — it states the intent → command → never mapping explicitly where prose has to be parsed for it. Not for terseness: as written, the three table openers run ~150 characters *longer* than the prose rewrite, a rounding error against the prompt but the opposite of the usual assumption. Measure the actual texts before claiming either form is cheaper.

One failure shape dominates and no wording tested changes it — only how often it fires: the model runs the shell command, then writes the correct `weaver` invocation *into a prose message* instead of emitting it as a tool call. It is not failing to know; it is failing to convert. Aim new tactics at conversion.

Whether any structure reliably transfers across hosts and models remains open (see handoff). Design against the principle; prove any specific tactic on the lane before trusting it.

## Own the whole problem a skill claims

An agent picks a skill by matching its intent to the description, then works mostly from that skill's body. Observed on the pressured trigger lane: rather than load a *second* skill mid-task to compose a step, it tends to fall back to host tools — a `grep` to locate — a specific case of "they won't plan the optimal sequence." Two design consequences (this scenario moved 0/6 → 6/6 once addressed):

- **Advertise the whole problem in the description, including precursor steps** — not just the terminal mechanic. A refactor skill that says "rename a symbol" but not "locates it for you if you don't have the line/col" loses the agent that wants a rename but has no position: it greps to locate and never converts, because nothing told it the skill handles finding the symbol. Putting the locate step only in the *body* does nothing until the *description* advertises it.
- **A tool can appear in more than one skill as a precursor.** `search-text` is the primary tool of the search-and-replace skill *and* a locate precursor in the refactor skill. Organize skills by the *problem* being solved, not by a one-tool-one-skill partition; the partition can strand a workflow that spans skills (locate → rename), because the agent may not assemble it across skill boundaries. Merging everything into one skill fixes composition but dilutes each per-problem trigger — keep sharp per-problem descriptions and let precursor tools overlap.

## Don't gate the act behind a check — a single-shot model stalls on the precursor

A "check first, *then* act" recipe in a skill body (`# 1. find-references  # 2. delete-file`, or "run the impact check first, then rename") makes a one-shot agent do step 1 and stop — it treats the precursor as *the* task and never converts to the mutating op. Observed: a delete section written as check-then-delete made the model emit `find-importers` and halt; a rename section that said "get the blast radius first, then act" made it emit `find-references` and halt. Write the mutating op as the one call to make; offer any impact check as an explicitly *optional* inspection ("want the importers first anyway? — optional, not a prerequisite"), never as step 1 of a sequence. The op already does the safe thing (delete-file removes importers; rename updates every reference), so the check is never required.

## Preempt the shell reflex — name what the op does that the shell can't

When a task maps to a familiar shell command, the agent reaches for the shell unless the body preempts it. `move-file` emitted `mkdir -p && mv` because the section never said weaver creates the destination directory — the model assumed it had to make the dir itself, and once it's in "shell mode" it does the whole thing in shell. Fix: state the shell steps the op subsumes ("don't `mkdir` the destination or `mv` the file yourself — creates missing destination directories and rewrites every importer"). A terse section that only lists the op's *benefits* loses to muscle memory; naming the exact shell steps it replaces wins.

Corollary: an operation's optional impact check must be the *right-granularity* tool. Deleting a **file** → `find-importers` (file-level, "who imports this file?"). A symbol-level `find-references` at a made-up `1:1` position is wrong for a file op — it resolves references to whatever token sits at the top of the file.
