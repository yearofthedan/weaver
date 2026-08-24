import type { DispatchResponse } from "./dispatcher.js";

/**
 * Serialise a `DispatchResponse` for the socket, newline-terminated.
 *
 * `handleSocketRequest` runs inside a promise-chain mutex — if it ever
 * rejects, the queue stays rejected and every later request is silently
 * dropped. `JSON.stringify` throws on a circular result (a mistake in an
 * operation's return value, not a caller error), so it is guarded here
 * rather than left as the one remaining unguarded throw on that path.
 */
export function serialiseResponse(response: DispatchResponse): string {
  try {
    return `${JSON.stringify(response)}\n`;
  } catch {
    return `${JSON.stringify({
      status: "error",
      error: "INTERNAL_ERROR",
      message: "response could not be serialised",
    })}\n`;
  }
}
