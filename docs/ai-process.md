# AI Agent Process Notes

Hard-won rules for working on this codebase. Update this file when a session goes wrong.

---

## Rule 1: Read `package.json` before touching `node_modules`

**What went wrong:** An agent used `Glob` to search the pnpm store directory for package versions. It found `@vue+language-core@2.2.12` in the store path and assumed that was the installed version. It then spent significant time researching the v2 API. The actual installed version was `3.2.4` (declared in `package.json`, resolved in `pnpm-lock.yaml`).

**Why it happened:** pnpm keeps old package versions in its content-addressed store even after they are no longer the resolved version. Store directory names are not reliable as version sources.

**The rule:** Before doing any research on a dependency's API, read `package.json` first. Then confirm against `pnpm-lock.yaml` if there is any doubt. Do not infer versions from `node_modules/.pnpm/` directory names.

**If node_modules looks stale** (lock file says one version, store has another): `pnpm store prune && rm -rf node_modules && pnpm install`. This came up after a major version bump of `@vue/language-core` from v2 to v3 — the lock file was updated but install had not been run.

---

## Rule 2: Establish ground truth before exploring

**What went wrong:** A session spent ~$10 in tokens debugging the cross-boundary Vue rename issue. The root cause was correctly identified early (TypeScript ignores non-`.ts` filenames in `getScriptFileNames`) but the session kept probing symptoms rather than committing to a fix and reading the relevant source precisely.

**The rule:** Once you understand the root cause, stop exploring and read the exact source you need. In this case: read `decorateLanguageServiceHost.js` to understand exactly what it patches (answer: `getScriptSnapshot` and `getScriptKind` — NOT `getScriptFileNames`). That single fact unlocks the whole fix. Reaching for it directly costs one file read, not ten rounds of inference.

---

## Rule 3: When confused, stop and ask — do not assume

The user's standing instruction: *"if there is confusion at all you MUST stop and ask me clarifying questions."*

Both failures above involved an agent making an assumption rather than surfacing the confusion. The version mismatch was visible in the glob output (two versions present) but the agent didn't flag it. Flag ambiguity early; the cost of asking is zero compared to the cost of building on wrong assumptions.

---

## Rule 4: Verify research agent output against the correct version

When delegating API research to a subagent, tell it explicitly which package version to look at and ask it to confirm the version from `package.json` inside the package directory before reading any source. A research agent that reads the wrong version is worse than useless — it produces confident, plausible, wrong answers.
