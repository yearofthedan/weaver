import * as path from "node:path";
import { watch } from "chokidar";
import { SKIP_DIRS } from "../engines/file-walk.js";

export interface WatcherCallbacks {
  /** A watched file's content changed in place. Use for selective TS refresh. */
  onFileChanged: (filePath: string) => void;
  /** A new watched file was created. Requires full engine rebuild. */
  onFileAdded: (filePath: string) => void;
  /** A watched file was deleted. Requires full engine rebuild. */
  onFileRemoved: (filePath: string) => void;
}

export interface WatcherHandle {
  stop: () => Promise<void>;
}

function shouldIgnore(filePath: string): boolean {
  const segments = filePath.split(path.sep);
  return segments.some((seg) => SKIP_DIRS.has(seg));
}

const DEBOUNCE_MS = 200;

export function startWatcher(
  workspaceRoot: string,
  extensions: ReadonlySet<string>,
  callbacks: WatcherCallbacks,
): WatcherHandle {
  // Per-file pending timers — last event type wins within the debounce window.
  const pending = new Map<string, { type: "change" | "add" | "unlink"; timer: NodeJS.Timeout }>();

  function schedule(filePath: string, type: "change" | "add" | "unlink"): void {
    const existing = pending.get(filePath);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      pending.delete(filePath);
      if (type === "change") callbacks.onFileChanged(filePath);
      else if (type === "add") callbacks.onFileAdded(filePath);
      else callbacks.onFileRemoved(filePath);
    }, DEBOUNCE_MS);

    pending.set(filePath, { type, timer });
  }

  const watcher = watch(workspaceRoot, {
    ignored: (filePath: string) => shouldIgnore(filePath),
    ignoreInitial: true,
    // Don't keep the event loop alive — the daemon's socket server does that.
    persistent: false,
  });

  const isWatched = (filePath: string) => extensions.has(path.extname(filePath));

  watcher.on("change", (filePath: string) => {
    if (isWatched(filePath)) schedule(filePath, "change");
  });

  watcher.on("add", (filePath: string) => {
    if (isWatched(filePath)) schedule(filePath, "add");
  });

  watcher.on("unlink", (filePath: string) => {
    if (isWatched(filePath)) schedule(filePath, "unlink");
  });

  return {
    stop: async () => {
      for (const { timer } of pending.values()) clearTimeout(timer);
      pending.clear();
      await watcher.close();
    },
  };
}
