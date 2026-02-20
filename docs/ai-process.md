# AI Agent Process Notes

Hard-won rules for working on this codebase. Update this file when a session goes wrong.

---

## Rule 1: Read `package.json` before researching a dependency's API

pnpm keeps old versions in its content-addressed store even after they are no longer resolved. Directory names under `node_modules/.pnpm/` are not reliable version sources — an agent once found `@vue+language-core@2.2.12` in the store and spent a session on the wrong API. The installed version was `3.2.4`.

Read `package.json` first. Confirm against `pnpm-lock.yaml` if in doubt. If the lock file and `node_modules` look out of sync: `pnpm store prune && rm -rf node_modules && pnpm install`.

---

## Rule 2: Once the root cause is known, read the exact source — stop probing symptoms

A session spent ~$10 debugging the cross-boundary Vue rename issue. The root cause was identified early (TypeScript silently ignores non-`.ts` filenames in `getScriptFileNames`) but the session kept exploring instead of reading `decorateLanguageServiceHost.js` directly. That one file read answers the question. Stop inferring; read the source.

---

## Rule 3: When confused, stop and ask — do not assume

The user's standing instruction: *"if there is confusion at all you MUST stop and ask me clarifying questions."*

Both failures above involved an agent making an assumption rather than surfacing confusion. Flag ambiguity early; the cost of asking is zero compared to building on a wrong assumption.

---

## Rule 4: Tell research subagents which version to use and ask them to verify it

A subagent reading the wrong package version produces confident, plausible, wrong answers. When delegating API research, explicitly state the version and instruct the subagent to confirm it from `package.json` inside the package directory before reading any source.
