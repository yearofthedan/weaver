import { afterEach } from "vitest";
import { invalidateAll } from "../daemon/language-plugin-registry.js";

/**
 * Make the test process hermetic against an inherited git environment.
 *
 * Several suites shell out to `git` inside throwaway temp directories. When the
 * test run is launched from a git hook (e.g. husky pre-commit running
 * `pnpm check`), git exports repo-discovery variables — `GIT_DIR`,
 * `GIT_INDEX_FILE`, … — into the environment. A child `git` started with a
 * `cwd` then ignores that `cwd` and operates on the host repository instead.
 * On a normal checkout the leaked `GIT_DIR` is the relative `.git`, so it
 * harmlessly fails to resolve from a temp dir; in a linked worktree git
 * exports an absolute path, so the temp-dir `git add`/`git commit` calls write
 * straight into the real repo and corrupt it. Stripping these forces every
 * spawned `git` to discover its repository from `cwd` alone. In a normal run
 * none of these are set, so this is a no-op.
 */
for (const key of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
]) {
  delete process.env[key];
}

/**
 * Global test cleanup: dispose of cached engines after each test.
 * Prevents memory leaks from accumulated Project instances in TsMorphEngine.
 */
afterEach(() => {
  invalidateAll();
});
