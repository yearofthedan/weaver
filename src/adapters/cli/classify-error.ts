export function classifyDaemonError(err: unknown): "DAEMON_STARTING" | "INTERNAL_ERROR" {
  if (!(err instanceof Error)) return "INTERNAL_ERROR";
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ECONNREFUSED" || code === "ENOENT" || code === "ECONNRESET")
    return "DAEMON_STARTING";
  if (err.message.includes("timed out")) return "DAEMON_STARTING";
  return "INTERNAL_ERROR";
}
