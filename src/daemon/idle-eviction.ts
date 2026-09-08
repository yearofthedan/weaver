export interface IdleTimerOpts {
  /** Returns the current time in milliseconds (e.g. `Date.now`). */
  now: () => number;
  /** Called when the idle timeout has been reached. */
  evict: () => void;
  /** Duration of inactivity in milliseconds before `evict` is called (default: 5 min). */
  timeoutMs?: number;
  /** How often to check for idle state in milliseconds (default: 60 s). */
  intervalMs?: number;
}

export interface IdleTimer {
  /** Resets the idle countdown — call on every operation request. */
  reset: () => void;
  /** Stops the interval and prevents `evict` from ever being called. */
  stop: () => void;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 60 * 1000;

export function startIdleTimer(opts: IdleTimerOpts): IdleTimer {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  let lastActivity = opts.now();
  let evicted = false;

  const handle = setInterval(() => {
    if (!evicted && opts.now() - lastActivity >= timeoutMs) {
      evicted = true;
      opts.evict();
    }
  }, intervalMs);

  handle.unref();

  return {
    reset: () => {
      lastActivity = opts.now();
      evicted = false;
    },
    stop: () => {
      clearInterval(handle);
    },
  };
}
